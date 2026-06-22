import axios from 'axios';
import { config } from '../../../config';
import { AirtableRepository } from '../repositories/airtable.repository';
import { cache } from '../../../common/cache';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  basicAuthHeader,
  refreshAccessToken,
  airtableGet,
} from '../helpers/airtable.helpers';

const repo = new AirtableRepository();

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
    await Promise.all(
      data.bases.map((base) =>
        repo.upsertBase(organizationId, base.id, {
          name: base.name,
          permissionLevel: base.permissionLevel,
          rawData: base,
        }),
      ),
    );
    await cache.del(`airtable:bases:${organizationId}`);
    return data.bases.length;
  },

  async syncTables(organizationId: string, baseId: string): Promise<number> {
    const data = await airtableGet<{ tables: any[] }>(organizationId, `/meta/bases/${baseId}/tables`);
    await Promise.all(
      data.tables.map((table) =>
        repo.upsertTable(organizationId, baseId, table.id, {
          name: table.name,
          primaryFieldId: table.primaryFieldId,
          fields: table.fields || [],
          views: table.views || [],
          rawData: table,
        }),
      ),
    );
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

      await Promise.all(
        data.records.map((record) =>
          repo.upsertRecord(organizationId, baseId, tableId, record.id, {
            fields: record.fields,
            createdTime: record.createdTime ? new Date(record.createdTime) : undefined,
          }),
        ),
      );

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
        const validUsers = usersData.users.filter((u) => u.id || u.userId);
        await Promise.all(
          validUsers.map((user) =>
            repo.upsertUser(organizationId, user.id || user.userId, {
              name: user.name,
              email: user.email,
              scimEnabled: user.scimEnabled,
              rawData: user,
            }),
          ),
        );
        const total = validUsers.length;
        console.log(`[Users] source=enterprise  count=${total}`);
        return { total, source: 'enterprise' };
      }
    } catch (err: any) {
      console.log('[Users] enterprise /meta/users unavailable (HTTP', err?.response?.status ?? 'n/a', ') — falling back to standard endpoints');
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
      console.log(`[Users] source=whoami  ${total} user(s) added`);
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
        const validCollabs = list.filter((u) => u.id || u.userId);
        await Promise.all(
          validCollabs.map((user) =>
            repo.upsertUser(organizationId, user.id || user.userId, {
              name: user.name,
              email: user.email,
              rawData: user,
            }),
          ),
        );
        total += validCollabs.length;
        console.log(`[Users] source=collaborators (base ${base.baseId})  count=${validCollabs.length}`);
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
      const cursor = repo.streamRecords(organizationId);

      const toUpsert: Array<{ uid: string; name: string; email: string; rawData: any }> = [];
      for await (const record of cursor) {
        for (const value of Object.values(record.fields ?? {})) {
          const candidates = Array.isArray(value) ? value : [value];
          for (const item of candidates) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              const uid: string = item.id;
              const email: string = item.email;
              const name: string = item.name;
              if (uid && email && !seenIds.has(uid)) {
                seenIds.add(uid);
                toUpsert.push({ uid, name, email, rawData: item });
              }
            }
          }
        }
      }
      await Promise.all(
        toUpsert.map(({ uid, name, email, rawData }) =>
          repo.upsertUser(organizationId, uid, { name, email, rawData }),
        ),
      );
      total += toUpsert.length;
      console.log(`[Users] source=standard (record-field extraction)  count=${total}`);
    } else {
      console.log(`[Users] source=standard (whoami + collaborators)  count=${total}`);
    }
    return { total, source: 'standard' };
  },

  async syncAll(organizationId: string): Promise<Record<string, number>> {
    // Step 1: sync base metadata first (sequential — single API call)
    const bases = await AirtableService.syncBases(organizationId);
    const baseDocs = await repo.getBases(organizationId);

    // Step 2: sync tables + records per base in parallel
    // Each base has its own rate-limit bucket so cross-base parallelism is safe
    const baseResults = await Promise.all(
      baseDocs.map(async (base) => {
        // Tables must finish before records (need tableIds)
        const t = await AirtableService.syncTables(organizationId, base.baseId);
        const tableDocs = await repo.getTables(organizationId, base.baseId);

        // Records for all tables within this base run sequentially
        // (same base = same rate-limit bucket)
        let r = 0;
        for (const table of tableDocs) {
          r += await AirtableService.syncRecords(organizationId, base.baseId, table.tableId);
        }

        return { tables: t, records: r };
      }),
    );

    const tables = baseResults.reduce((sum, b) => sum + b.tables, 0);
    const records = baseResults.reduce((sum, b) => sum + b.records, 0);

    // Step 3: sync users (independent of bases/tables — runs after to avoid extra rate-limit pressure)
    let users = 0;
    try {
      const result = await AirtableService.syncUsers(organizationId);
      users = result.total;
    } catch (err: any) {
      console.warn('[syncAll] syncUsers failed:', err?.message ?? err);
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
  getCounts: (orgId: string) => repo.getCounts(orgId),
};
