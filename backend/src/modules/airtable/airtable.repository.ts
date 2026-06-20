import { AirtableConnectionModel, IAirtableConnection } from './schemas/airtable-connection.schema';
import { AirtableBaseModel, IAirtableBase } from './schemas/airtable-base.schema';
import { AirtableTableModel, IAirtableTable } from './schemas/airtable-table.schema';
import { AirtableRecordModel, IAirtableRecord } from './schemas/airtable-record.schema';
import { AirtableUserModel, IAirtableUser } from './schemas/airtable-user.schema';

export class AirtableRepository {
  // Connection
  async upsertConnection(organizationId: string, data: Partial<IAirtableConnection>): Promise<IAirtableConnection> {
    return AirtableConnectionModel.findOneAndUpdate(
      { organizationId },
      { ...data, organizationId },
      { upsert: true, new: true },
    );
  }

  async getConnection(organizationId: string): Promise<IAirtableConnection | null> {
    return AirtableConnectionModel.findOne({ organizationId });
  }

  async deleteConnection(organizationId: string): Promise<void> {
    await AirtableConnectionModel.deleteOne({ organizationId });
  }

  async saveOAuthState(organizationId: string, state: string, codeVerifier: string): Promise<void> {
    await AirtableConnectionModel.findOneAndUpdate(
      { organizationId },
      { organizationId, state, codeVerifier, accessToken: '', refreshToken: '', expiresAt: new Date(), scope: '' },
      { upsert: true, new: true },
    );
  }

  async getConnectionByState(state: string): Promise<IAirtableConnection | null> {
    return AirtableConnectionModel.findOne({ state });
  }

  // Bases
  async upsertBase(organizationId: string, baseId: string, data: Partial<IAirtableBase>): Promise<IAirtableBase> {
    return AirtableBaseModel.findOneAndUpdate(
      { organizationId, baseId },
      { ...data, organizationId, baseId, syncedAt: new Date() },
      { upsert: true, new: true },
    );
  }

  async getBases(organizationId: string): Promise<IAirtableBase[]> {
    return AirtableBaseModel.find({ organizationId }).sort({ name: 1 });
  }

  // Tables
  async upsertTable(organizationId: string, baseId: string, tableId: string, data: Partial<IAirtableTable>): Promise<IAirtableTable> {
    return AirtableTableModel.findOneAndUpdate(
      { organizationId, baseId, tableId },
      { $set: { ...data, organizationId, baseId, tableId, syncedAt: new Date() } },
      { upsert: true, new: true },
    );
  }

  async getTables(organizationId: string, baseId: string): Promise<IAirtableTable[]> {
    return AirtableTableModel.find({ organizationId, baseId }).sort({ name: 1 });
  }

  async getAllTables(organizationId: string): Promise<IAirtableTable[]> {
    return AirtableTableModel.find({ organizationId }).sort({ name: 1 });
  }

  // Records
  async upsertRecord(organizationId: string, baseId: string, tableId: string, recordId: string, data: Partial<IAirtableRecord>): Promise<IAirtableRecord> {
    return AirtableRecordModel.findOneAndUpdate(
      { organizationId, baseId, tableId, recordId },
      { ...data, organizationId, baseId, tableId, recordId, syncedAt: new Date() },
      { upsert: true, new: true },
    );
  }

  async getRecords(organizationId: string, filter: Record<string, any> = {}, page = 1, pageSize = 100): Promise<{ records: IAirtableRecord[]; total: number }> {
    const query = { organizationId, ...filter };
    const [records, total] = await Promise.all([
      AirtableRecordModel.find(query)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .sort({ createdTime: -1 }),
      AirtableRecordModel.countDocuments(query),
    ]);
    return { records, total };
  }

  async getRecordsByTable(organizationId: string, baseId: string, tableId: string): Promise<IAirtableRecord[]> {
    return AirtableRecordModel.find({ organizationId, baseId, tableId });
  }

  // Users
  async upsertUser(organizationId: string, userId: string, data: Partial<IAirtableUser>): Promise<IAirtableUser> {
    return AirtableUserModel.findOneAndUpdate(
      { organizationId, userId },
      { ...data, organizationId, userId, syncedAt: new Date() },
      { upsert: true, new: true },
    );
  }

  async getUsers(organizationId: string): Promise<IAirtableUser[]> {
    return AirtableUserModel.find({ organizationId }).sort({ name: 1 });
  }
}
