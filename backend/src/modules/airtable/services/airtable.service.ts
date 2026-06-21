import crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import { config } from '../../../config';
import { AirtableRepository } from '../repositories/airtable.repository';
import { IAirtableConnection } from '../schemas/airtable-connection.schema';
import { AirtableRecordModel } from '../schemas/airtable-record.schema';
import { cache } from '../../../common/cache';

const repo = new AirtableRepository();

// Airtable enforces 5 req/sec per base. We stay well under that.
const AIRTABLE_RATE_LIMIT_DELAY_MS = 220; // ~4.5 req/sec
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

function basicAuthHeader(): string {
  const credentials = Buffer.from(`${config.airtable.clientId}:${config.airtable.clientSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

async function getValidToken(organizationId: string): Promise<string> {
  const conn = await repo.getConnection(organizationId);
  if (!conn || !conn.accessToken) throw new Error('Airtable not connected for this organization');

  if (conn.expiresAt && conn.expiresAt <= new Date()) {
    return refreshAccessToken(organizationId, conn);
  }
  return conn.accessToken;
}

async function refreshAccessToken(organizationId: string, conn: IAirtableConnection): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
  });

  const response = await axios.post(config.airtable.tokenUrl, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuthHeader(),
    },
  });

  const { access_token, refresh_token, expires_in, scope } = response.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  // Invalidate cached status on token refresh
  await cache.del(`airtable:status:${organizationId}`);

  await repo.upsertConnection(organizationId, {
    accessToken: access_token,
    refreshToken: refresh_token || conn.refreshToken,
    expiresAt,
    scope,
  });

  return access_token;
}

/**
 * Airtable GET with automatic 429 retry and exponential backoff.
 * Respects the Retry-After header when present.
 */
async function airtableGet<T>(
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
        : Math.min(1000 * 2 ** attempt, 30_000); // 1s, 2s, 4s, 8s cap 30s

      console.warn(`[Airtable] 429 rate limited — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(waitMs);
      return airtableGet(organizationId, path, params, attempt + 1);
    }

    throw err;
  }
}

export const AirtableService = {
  // OAuth
  initiateOAuth(organizationId: string): { url: string; state: string; codeVerifier: string } {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: config.airtable.clientId,
      redirect_uri: config.airtable.redirectUri,
      response_type: 'code',
      scope: config.airtable.scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: `${config.airtable.authUrl}?${params.toString()}`,
      state,
      codeVerifier,
    };
  },

  async saveOAuthState(organizationId: string, state: string, codeVerifier: string): Promise<void> {
    await repo.saveOAuthState(organizationId, state, codeVerifier);
  },

  async exchangeCode(code: string, state: string): Promise<void> {
    const conn = await repo.getConnectionByState(state);
    if (!conn) throw new Error('Invalid OAuth state');

    const organizationId = conn.organizationId;
    const codeVerifier = conn.codeVerifier;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.airtable.redirectUri,
      code_verifier: codeVerifier || '',
    });

    const response = await axios.post(config.airtable.tokenUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basicAuthHeader(),
      },
    });

    const { access_token, refresh_token, expires_in, scope } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await cache.del(`airtable:status:${organizationId}`);

    await repo.upsertConnection(organizationId, {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      scope,
      state: undefined,
      codeVerifier: undefined,
    });
  },

  async getConnectionStatus(organizationId: string) {
    const cacheKey = `airtable:status:${organizationId}`;
    const cached = await cache.get<{ connected: boolean; expiresAt?: Date; scope?: string; isExpired?: boolean; lastSyncedAt?: Date }>(cacheKey);
    if (cached) return cached;

    const conn = await repo.getConnection(organizationId);
    let result;
    if (!conn || !conn.accessToken) {
      result = { connected: false };
    } else {
      const accessTokenExpired = conn.expiresAt && conn.expiresAt <= new Date();
      if (accessTokenExpired) {
        // Access token expired — silently refresh using the refresh token before reporting status.
        // Only mark as truly expired if the refresh itself fails (refresh token also expired).
        try {
          await refreshAccessToken(organizationId, conn);
          const refreshed = await repo.getConnection(organizationId);
          result = { connected: true, expiresAt: refreshed?.expiresAt, scope: refreshed?.scope, isExpired: false, lastSyncedAt: conn.lastSyncedAt };
        } catch {
          result = { connected: true, expiresAt: conn.expiresAt, scope: conn.scope, isExpired: true, lastSyncedAt: conn.lastSyncedAt };
        }
      } else {
        result = { connected: true, expiresAt: conn.expiresAt, scope: conn.scope, isExpired: false, lastSyncedAt: conn.lastSyncedAt };
      }
    }

    await cache.set(cacheKey, result, 300); // 5-min TTL
    return result;
  },

  async disconnect(organizationId: string): Promise<void> {
    await repo.deleteConnection(organizationId);
    await cache.delPattern(`airtable:*:${organizationId}`);
  },

  // Data sync
  async syncBases(organizationId: string): Promise<number> {
    const data = await airtableGet<{ bases: any[] }>(organizationId, '/meta/bases');
    for (const base of data.bases) {
      await repo.upsertBase(organizationId, base.id, {
        name: base.name,
        permissionLevel: base.permissionLevel,
        rawData: base,
      });
    }
    // Invalidate bases cache after sync
    await cache.del(`airtable:bases:${organizationId}`);
    return data.bases.length;
  },

  async syncTables(organizationId: string, baseId: string): Promise<number> {
    const data = await airtableGet<{ tables: any[] }>(organizationId, `/meta/bases/${baseId}/tables`);
    for (const table of data.tables) {
      await repo.upsertTable(organizationId, baseId, table.id, {
        name: table.name,
        primaryFieldId: table.primaryFieldId,
        fields: table.fields || [],
        views: table.views || [],
        rawData: table,
      });
    }
    await cache.del(`airtable:tables:${organizationId}:${baseId}`);
    return data.tables.length;
  },

  async syncRecords(organizationId: string, baseId: string, tableId: string): Promise<number> {
    let offset: string | undefined;
    let total = 0;

    do {
      const params: Record<string, any> = { pageSize: 100 };
      if (offset) params.offset = offset;

      const data = await airtableGet<{ records: any[]; offset?: string }>(
        organizationId,
        `/${baseId}/${tableId}`,
        params,
      );

      for (const record of data.records) {
        await repo.upsertRecord(organizationId, baseId, tableId, record.id, {
          fields: record.fields,
          createdTime: record.createdTime ? new Date(record.createdTime) : undefined,
        });
      }

      total += data.records.length;
      offset = data.offset;
    } while (offset);

    return total;
  },

  async syncUsers(
    organizationId: string,
  ): Promise<{ total: number; source: 'enterprise' | 'standard' }> {
    let total = 0;

    // Primary: enterprise GET /meta/users endpoint
    try {
      const usersData = await airtableGet<{ users: any[] }>(organizationId, '/meta/users');
      if (usersData?.users?.length) {
        for (const user of usersData.users) {
          const uid = user.id || user.userId;
          if (!uid) continue;
          await repo.upsertUser(organizationId, uid, {
            name: user.name,
            email: user.email,
            scimEnabled: user.scimEnabled,
            rawData: user,
          });
          total++;
        }
        console.log(`[Users] source=enterprise  count=${total}`);
        return { total, source: 'enterprise' };
      }
    } catch {
      // Enterprise endpoint unavailable on this plan — fall back below
    }

    // Fallback: GET /meta/whoami + GET /meta/bases/{id}/collaborators (standard plan)
    const whoami = await airtableGet<any>(organizationId, '/meta/whoami');
    if (whoami?.id) {
      await repo.upsertUser(organizationId, whoami.id, {
        name: whoami.name,
        email: whoami.email,
        rawData: whoami,
      });
      total++;
    }

    // Tier 2: per-base collaborators (Pro/Enterprise plans only — 404 on Trial/Free)
    const bases = await repo.getBases(organizationId);
    let collaboratorsAvailable = false;
    for (const base of bases) {
      try {
        const collabData = await airtableGet<any>(
          organizationId,
          `/meta/bases/${base.baseId}/collaborators`,
        );
        const list: any[] = collabData?.collaborators ?? collabData?.users ?? [];
        collaboratorsAvailable = true;
        for (const user of list) {
          const uid = user.id || user.userId;
          if (!uid) continue;
          await repo.upsertUser(organizationId, uid, {
            name: user.name,
            email: user.email,
            rawData: user,
          });
          total++;
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404 || status === 403) {
          console.log(`[Users] collaborators endpoint not available on this plan (HTTP ${status}) — using record-field extraction instead`);
        } else {
          console.warn(`[Users] collaborators fetch failed for base ${base.baseId}:`, err?.message);
        }
      }
    }

    // Tier 3: extract unique users from collaborator-type fields in synced records
    // Works on all plans — Airtable embeds {id, email, name} inside collaborator fields.
    if (!collaboratorsAvailable) {
      const seenIds = new Set<string>([whoami?.id].filter(Boolean));
      const records = await AirtableRecordModel.find({ organizationId }).lean();

      for (const record of records) {
        for (const value of Object.values(record.fields ?? {})) {
          const candidates = Array.isArray(value) ? value : [value];
          for (const item of candidates) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const uid: string = item.id;
              const email: string = item.email;
              const name: string = item.name;
              if (uid && email && !seenIds.has(uid)) {
                seenIds.add(uid);
                await repo.upsertUser(organizationId, uid, { name, email, rawData: item });
                total++;
              }
            }
          }
        }
      }
      console.log(`[Users] source=standard (record-field extraction)  count=${total}`);
    } else {
      console.log(`[Users] source=standard (whoami + collaborators)  count=${total}`);
    }
    return { total, source: 'standard' };
  },

  async syncAll(organizationId: string): Promise<Record<string, number>> {
    const bases = await AirtableService.syncBases(organizationId);
    const baseDocs = await repo.getBases(organizationId);

    let tables = 0;
    let records = 0;

    for (const base of baseDocs) {
      const t = await AirtableService.syncTables(organizationId, base.baseId);
      tables += t;

      const tableDocs = await repo.getTables(organizationId, base.baseId);
      for (const table of tableDocs) {
        const r = await AirtableService.syncRecords(organizationId, base.baseId, table.tableId);
        records += r;
      }
    }

    let users = 0;
    try {
      const result = await AirtableService.syncUsers(organizationId);
      users = result.total;
    } catch {
      // Users endpoint may not be available in all plans
    }

    await repo.updateConnection(organizationId, { lastSyncedAt: new Date() });
    await cache.del(`airtable:status:${organizationId}`);

    return { bases, tables, records, users };
  },

  // Cached repository accessors
  async getBases(orgId: string) {
    const cacheKey = `airtable:bases:${orgId}`;
    const cached = await cache.get<any[]>(cacheKey);
    if (cached) return cached;
    const result = await repo.getBases(orgId);
    await cache.set(cacheKey, result, 120); // 2-min TTL
    return result;
  },

  getTables: (orgId: string, baseId: string) => repo.getTables(orgId, baseId),
  getAllTables: (orgId: string) => repo.getAllTables(orgId),
  getRecords: (orgId: string, filter: any, page: number, pageSize: number) =>
    repo.getRecords(orgId, filter, page, pageSize),
  getUsers: (orgId: string) => repo.getUsers(orgId),
};
