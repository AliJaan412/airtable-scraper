export namespace AirtableActions {
  export class LoadStatus {
    static readonly type = '[Airtable] Load Status';
  }

  export class LoadBases {
    static readonly type = '[Airtable] Load Bases';
  }

  export class Connect {
    static readonly type = '[Airtable] Connect';
  }

  export class Disconnect {
    static readonly type = '[Airtable] Disconnect';
  }

  export class SyncAll {
    static readonly type = '[Airtable] Sync All';
  }

  export class ClearCache {
    static readonly type = '[Airtable] Clear Cache';
  }
}
