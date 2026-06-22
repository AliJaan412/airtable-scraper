import crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import { config } from '../../../config';
import { cache } from '../../../common/cache';
import { sleep } from '../../../common/utils';
import { AirtableRepository } from '../repositories/airtable.repository';
import { IAirtableConnection } from '../schemas/airtable-connection.schema';

const repo = new AirtableRepository();

export const AIRTABLE_RATE_LIMIT_DELAY_MS = 220; // ~4.5 req/sec — stays under Airtable's 5 req/sec limit
export const MAX_RETRIES = 4;

// ── PKCE / OAuth helpers ──────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function basicAuthHeader(): string {
  const credentials = Buffer.from(
    `${config.airtable.clientId}:${config.airtable.clientSecret}`,
  ).toString('base64');
  return `Basic ${credentials}`;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

export async function getValidToken(organizationId: string): Promise<string> {
  const conn = await repo.getConnection(organizationId);
  if (!conn || !conn.accessToken) throw new Error('Airtable not connected for this organization');

  if (conn.expiresAt && conn.expiresAt <= new Date()) {
    return refreshAccessToken(organizationId, conn);
  }
  return conn.accessToken;
}

export async function refreshAccessToken(
  organizationId: string,
  conn: IAirtableConnection,
): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
  });

  const response = await axios.post(config.airtable.tokenUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
  });

  const { access_token, refresh_token, expires_in, scope } = response.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await cache.del(`airtable:status:${organizationId}`);
  // Use updateConnection ($set) here — upsertConnection does a full replacement
  // and would wipe lastSyncedAt and other fields not present in the refresh payload.
  await repo.updateConnection(organizationId, {
    accessToken: access_token,
    refreshToken: refresh_token || conn.refreshToken,
    expiresAt,
    scope,
  });

  return access_token;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Airtable GET with automatic 429 retry and exponential backoff.
 * Respects the Retry-After header when present.
 */
export async function airtableGet<T>(
  organizationId: string,
  path: string,
  params?: Record<string, any>,
  attempt = 0,
): Promise<T> {
  const token = await getValidToken(organizationId);

  try {
    await sleep(AIRTABLE_RATE_LIMIT_DELAY_MS);
    const response = await axios.get(`${config.airtable.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
    });
    return response.data;
  } catch (err) {
    const axiosErr = err as AxiosError;

    if (axiosErr.response?.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = axiosErr.response.headers['retry-after'];
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * 2 ** attempt, 30_000); // 1s → 2s → 4s → 8s, capped 30s

      console.warn(
        `[Airtable] 429 rate limited — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      return airtableGet(organizationId, path, params, attempt + 1);
    }

    throw err;
  }
}
