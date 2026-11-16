import { createPublicKey, verify as edVerify } from 'node:crypto';
import type { DB } from '../db.js';

/** §6.13 / §12.3 — Discord interaction signature verification (Ed25519). */

export function verifyDiscordSignature(params: {
  publicKeyHex: string | undefined;
  signatureHex: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer | undefined;
}): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = params;
  if (!publicKeyHex || !signatureHex || !timestamp || !rawBody) return false;
  // Reject stale/replayed requests outside a 5-minute window.
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  try {
    const key = createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(publicKeyHex, 'hex').toString('base64url'),
      },
      format: 'jwk',
    });
    return edVerify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

export interface InteractionResponse {
  status: number;
  body: Record<string, unknown>;
}

const ephemeral = (content: string): InteractionResponse => ({
  status: 200,
  body: { type: 4, data: { content, flags: 64 } },
});

export function handleInteraction(db: DB, payload: Record<string, any>, interactionId?: string): InteractionResponse {
  if (payload?.type === 1) return { status: 200, body: { type: 1 } };
  if (payload?.type === 2) {
    if (interactionId) {
      const seen = db.prepare('SELECT 1 AS hit FROM discord_interactions WHERE id = ?').get(interactionId);
      if (seen) return ephemeral('Cette interaction a déjà été traitée.');
      db.prepare('INSERT INTO discord_interactions (id, received_at) VALUES (?,?)').run(interactionId, Date.now());
    }
    const name = String(payload.data?.name ?? '');
    if (name === 'statut') {
      return ephemeral(
        '**SCP: Mirage Protocol** — site opérationnel.\n' +
        'Le jeu est en cours de développement : **aucune date de sortie n’est annoncée**.\n' +
        'Aucun launcher ni paiement n’est proposé sur ce site.',
      );
    }
    if (name === 'serveurs') {
      const rows = db.prepare(
        "SELECT name, current_players, max_players FROM servers WHERE status = 'active' AND deleted_at IS NULL ORDER BY avg_players DESC LIMIT 5",
      ).all() as { name: string; current_players: number; max_players: number }[];
      if (!rows.length) return ephemeral('Aucun serveur communautaire publié pour le moment.');
      return ephemeral(
        `**Serveurs communautaires (top 5)**\n${rows.map((r) => `• ${r.name} — ${r.current_players}/${r.max_players}`).join('\n')}`,
      );
    }
    if (name === 'wiki') {
      const query = String(payload.data?.options?.find((o: any) => o.name === 'recherche')?.value ?? '').toLowerCase();
      const rows = db.prepare(
        `SELECT c.slug, t.title FROM content c JOIN content_translations t ON t.content_id = c.id AND t.locale = 'fr'
         WHERE c.type = 'wiki' AND c.status = 'published' AND lower(t.title) LIKE ? LIMIT 5`,
      ).all(`%${query}%`) as { slug: string; title: string }[];
      if (!rows.length) return ephemeral('Aucun résultat dans le Wiki.');
      return ephemeral(`**Résultats Wiki**\n${rows.map((r) => `• ${r.title} — /wiki/${r.slug}`).join('\n')}`);
    }
    return ephemeral('Commande inconnue.');
  }
  return { status: 400, body: { error: 'unsupported_interaction' } };
}

export const DISCORD_COMMANDS = [
  { name: 'statut', description: 'État du site et du développement' },
  {
    name: 'wiki',
    description: 'Rechercher une page du Wiki',
    options: [{ type: 3, name: 'recherche', description: 'Termes de recherche', required: true }],
  },
  { name: 'serveurs', description: 'Afficher les serveurs communautaires les plus actifs' },
];
