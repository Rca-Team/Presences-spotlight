import { storageFileId } from './storage-id';
import { Query, ID, OAuthProvider, Permission, Role, Channel } from 'appwrite';
import {
  appwriteClient,
  databases,
  account,
  storage,
  functions,
  realtime,
  APPWRITE_CONFIG,
  getAppwriteStorageViewUrl,
  getAppwriteStorageDownloadUrl,
  getAppwriteStoragePreviewUrl,
  type ImageTransformOptions
} from './client';

const DATABASE_ID = APPWRITE_CONFIG.databaseId;

// Sanitize legacy URLs
function sanitizeImageUrl(url: any): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.includes('supabase.co')) {
    const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.*?)(?:\?|$)/);
    if (match) {
      return getAppwriteStorageViewUrl(match[1], storageFileId(decodeURIComponent(match[2])));
    }
  }
  return url;
}

// Document normalization helper
function normalizeDoc(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc;
  const normalized = { ...doc };
  if (normalized.$id && !normalized.id) {
    normalized.id = normalized.$id;
  }
  normalized.created_at ??= normalized.$createdAt;
  normalized.updated_at ??= normalized.$updatedAt;
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string' && /^[\[{]/.test(value)) {
      try { normalized[key] = JSON.parse(value); } catch {}
    }
  }
  if (normalized.avatar_url) normalized.avatar_url = sanitizeImageUrl(normalized.avatar_url);
  if (normalized.image_url) normalized.image_url = sanitizeImageUrl(normalized.image_url);
  if (normalized.photo_url) normalized.photo_url = sanitizeImageUrl(normalized.photo_url);

  // Parse JSON strings if necessary
  if (typeof normalized.descriptor === 'string' && (normalized.descriptor.startsWith('[') || normalized.descriptor.startsWith('{'))) {
    try {
      normalized.descriptor = JSON.parse(normalized.descriptor);
    } catch (_) {}
  }
  if (typeof normalized.metadata === 'string' && (normalized.metadata.startsWith('{') || normalized.metadata.startsWith('['))) {
    try {
      normalized.metadata = JSON.parse(normalized.metadata);
    } catch (_) {}
  }
  return normalized;
}

// Convert column name if needed ($id <-> id)
function mapColumnName(col: string): string {
  if (col === 'id') return '$id';
  return col;
}

function sanitizeDocForSave(data: any): any {
  const clean = { ...data };
  delete clean.id;
  delete clean.$id;
  delete clean.$createdAt;
  delete clean.$updatedAt;
  delete clean.$permissions;
  delete clean.$databaseId;
  delete clean.$collectionId;
  for (const [key, value] of Object.entries(clean)) {
    if (value !== null && typeof value === 'object') clean[key] = JSON.stringify(value);
  }
  return clean;
}

export class AppwriteQueryBuilder<T = any> implements PromiseLike<{ data: T | null; error: any; count?: number }> {
  private collectionName: string;
  private queries: string[] = [];
  private isSingle = false;
  private isMaybeSingle = false;
  private countMode: 'exact' | 'planned' | 'estimated' | null = null;
  private selectedFields: string[] = [];
  private emptyResult = false;
  private headOnly = false;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  select(fields = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    this.headOnly = options?.head ?? false;
    if (fields && fields !== '*') {
      const fieldList = fields.split(',').map(f => f.trim().replace(/:.*/, ''));
      const validFields = fieldList.filter(f => f && !f.includes('(') && !f.includes(')'));
      if (validFields.length > 0) {
        this.selectedFields = validFields;
      }
    }
    if (options?.count) {
      this.countMode = options.count;
    }
    return this;
  }

  eq(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null || value === undefined) {
      this.queries.push(Query.isNull(col));
    } else {
      this.queries.push(Query.equal(col, value));
    }
    return this;
  }

  neq(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null || value === undefined) {
      this.queries.push(Query.isNotNull(col));
    } else {
      this.queries.push(Query.notEqual(col, value));
    }
    return this;
  }

  gt(column: string, value: any): this {
    this.queries.push(Query.greaterThan(mapColumnName(column), value));
    return this;
  }

  gte(column: string, value: any): this {
    this.queries.push(Query.greaterThanEqual(mapColumnName(column), value));
    return this;
  }

  lt(column: string, value: any): this {
    this.queries.push(Query.lessThan(mapColumnName(column), value));
    return this;
  }

  lte(column: string, value: any): this {
    this.queries.push(Query.lessThanEqual(mapColumnName(column), value));
    return this;
  }

  in(column: string, values: any[]): this {
    if (Array.isArray(values) && values.length > 0) {
      this.queries.push(Query.equal(mapColumnName(column), values));
    } else this.emptyResult = true;
    return this;
  }

  contains(column: string, values: any): this {
    this.queries.push(Query.contains(mapColumnName(column), Array.isArray(values) ? values : [values]));
    return this;
  }

  containedBy(column: string, values: any): this {
    return this.contains(column, values);
  }

  like(column: string, pattern: string): this {
    const clean = pattern.replace(/%/g, '');
    this.queries.push(Query.search(mapColumnName(column), clean));
    return this;
  }

  ilike(column: string, pattern: string): this {
    return this.like(column, pattern);
  }

  is(column: string, value: any): this {
    const col = mapColumnName(column);
    if (value === null) {
      this.queries.push(Query.isNull(col));
    } else if (value === false) {
      this.queries.push(Query.equal(col, false));
    } else if (value === true) {
      this.queries.push(Query.equal(col, true));
    }
    return this;
  }

  not(column: string, operator: string, value: any): this {
    const col = mapColumnName(column);
    const op = (operator || '').toLowerCase();
    if (op === 'is' || op === 'eq') {
      if (value === null || value === undefined || value === 'null') {
        this.queries.push(Query.isNotNull(col));
      } else {
        this.queries.push(Query.notEqual(col, value));
      }
    } else if (op === 'in') {
      if (Array.isArray(value)) {
        value.forEach(v => this.queries.push(Query.notEqual(col, v)));
      } else if (typeof value === 'string') {
        const parsed = value.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        parsed.forEach(v => this.queries.push(Query.notEqual(col, v)));
      }
    } else {
      this.queries.push(Query.notEqual(col, value));
    }
    return this;
  }

  filter(column: string, operator: string, value: any): this {
    const op = (operator || '').toLowerCase();
    if (op === 'eq') return this.eq(column, value);
    if (op === 'neq') return this.neq(column, value);
    if (op === 'gt') return this.gt(column, value);
    if (op === 'gte') return this.gte(column, value);
    if (op === 'lt') return this.lt(column, value);
    if (op === 'lte') return this.lte(column, value);
    if (op === 'in') return this.in(column, Array.isArray(value) ? value : [value]);
    if (op === 'is') return this.is(column, value);
    if (op === 'like' || op === 'ilike') return this.like(column, value);
    if (op === 'contains') return this.contains(column, value);
    return this.eq(column, value);
  }

  match(query: Record<string, any>): this {
    if (query && typeof query === 'object') {
      for (const [key, val] of Object.entries(query)) {
        this.eq(key, val);
      }
    }
    return this;
  }

  or(filters: string): this {
    try {
      if (typeof (Query as any).or === 'function') {
        const parts = filters.split(',').map(f => f.trim());
        const subQueries: string[] = [];
        for (const part of parts) {
          const match = part.match(/^([^.]+)\.([^.]+)\.(.+)$/);
          if (match) {
            const [, col, op, val] = match;
            const cleanCol = mapColumnName(col);
            if (op === 'eq') subQueries.push(Query.equal(cleanCol, val));
            else if (op === 'neq') subQueries.push(Query.notEqual(cleanCol, val));
          }
        }
        if (subQueries.length > 0) {
          this.queries.push((Query as any).or(subQueries));
          return this;
        }
      }
    } catch (_) {}
    return this;
  }

  textSearch(column: string, query: string, _options?: any): this {
    return this.like(column, query);
  }

  overlaps(column: string, values: any): this {
    return this.contains(column, values);
  }

  abortSignal(_signal?: AbortSignal): this {
    return this;
  }

  returns<NewResult = any>(): AppwriteQueryBuilder<NewResult> {
    return this as any;
  }

  csv(): this {
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const col = mapColumnName(column);
    if (options?.ascending !== false) {
      this.queries.push(Query.orderAsc(col));
    } else {
      this.queries.push(Query.orderDesc(col));
    }
    return this;
  }

  limit(count: number): this {
    // Appwrite Cloud strictly caps single query limit to 100. Queries with limit > 100 trigger 400 Bad Request.
    const safeCount = Math.max(1, Math.min(Number(count) || 25, 100));
    try {
      this.queries = this.queries.filter(q => {
        try {
          const parsed = typeof q === 'string' ? JSON.parse(q) : q;
          return parsed.method !== 'limit';
        } catch {
          return true;
        }
      });
    } catch (_) {}
    this.queries.push(Query.limit(safeCount));
    return this;
  }

  range(from: number, to: number): this {
    const limit = Math.max(1, Math.min(to - from + 1, 100));
    try {
      this.queries = this.queries.filter(q => {
        try {
          const parsed = typeof q === 'string' ? JSON.parse(q) : q;
          return !['limit', 'offset'].includes(parsed.method);
        } catch {
          return true;
        }
      });
    } catch (_) {}
    this.queries.push(Query.limit(limit));
    this.queries.push(Query.offset(Math.max(0, from)));
    return this;
  }

  single(): this {
    this.isSingle = true;

    return this;
  }

  maybeSingle(): this {
    this.isMaybeSingle = true;

    return this;
  }

  private mutation: { kind: 'insert' | 'upsert' | 'update' | 'delete'; data?: any; options?: { onConflict?: string } } | null = null;
  private resultPromise: Promise<any> | null = null;

  insert(data: any, options?: any): this { this.mutation = { kind: 'insert', data, options }; return this; }
  upsert(data: any, options?: any): this { this.mutation = { kind: 'upsert', data, options }; return this; }
  update(data: any): this { this.mutation = { kind: 'update', data }; return this; }
  delete(): this { this.mutation = { kind: 'delete' }; return this; }

  private async readDocuments(all = false): Promise<{ documents: any[]; total: number }> {
    if (this.emptyResult) return { documents: [], total: 0 };
    if (this.headOnly && !this.mutation) {
      const response = await databases.listDocuments(DATABASE_ID, this.collectionName,
        [...this.queries.filter(q => !['limit', 'offset'].includes(JSON.parse(q).method)), Query.limit(1)]);
      return { documents: [], total: response.total };
    }
    // Filter out any select query from network calls to avoid Appwrite 400 schema errors on 'id'
    const queries = this.queries.filter(q => {
      try {
        const parsed = typeof q === 'string' && q.startsWith('{') ? JSON.parse(q) : null;
        if (parsed && parsed.method === 'select') return false;
      } catch (_) {}
      return true;
    });

    const hasLimit = queries.some(q => {
      try { return JSON.parse(q).method === 'limit'; } catch { return false; }
    });
    const boundedSingleRead = !all && !this.mutation && (this.isSingle || this.isMaybeSingle);
    if (!hasLimit) queries.push(Query.limit(boundedSingleRead ? 2 : 100));

    try {
      const response = await databases.listDocuments(DATABASE_ID, this.collectionName, queries);
      const documents = [...response.documents];
      if (!boundedSingleRead && (all || !hasLimit) && !queries.some(q => { try { return JSON.parse(q).method === 'offset'; } catch { return false; } })) {
        while (documents.length < response.total) {
          const page = await databases.listDocuments(DATABASE_ID, this.collectionName,
            [...queries.filter(q => { try { return JSON.parse(q).method !== 'limit'; } catch { return false; } }), Query.limit(100), Query.offset(documents.length)]);
          if (!page.documents.length) break;
          documents.push(...page.documents);
        }
      }
      return { documents, total: response.total };
    } catch (listErr: any) { throw listErr; }
  }

  private async run(): Promise<{ data: any; error: any; count?: number }> {
    try {
      let docs: any[];
      let count: number;
      if (!this.mutation) {
        const response = await this.readDocuments();
        docs = response.documents; count = response.total;
      } else {
        const { kind, data, options } = this.mutation;
        docs = [];
        if (kind === 'insert' || kind === 'upsert') {
          for (const rawItem of Array.isArray(data) ? data : [data]) {
            const item = { ...rawItem };
            if (this.collectionName === 'push_subscriptions') {
              if (!item.subscription && (item.endpoint || item.keys_p256dh || item.keys_auth)) {
                item.subscription = JSON.stringify({
                  endpoint: item.endpoint,
                  keys: {
                    p256dh: item.keys_p256dh,
                    auth: item.keys_auth,
                  },
                });
                delete item.endpoint;
                delete item.keys_p256dh;
                delete item.keys_auth;
                delete item.updated_at;
              }
            }
            let id = item.id || item.$id;
            if (kind === 'upsert' && !id && options?.onConflict) {
              const fields = options.onConflict.split(',').map(f => f.trim());
              try {
                const existing = await databases.listDocuments(DATABASE_ID, this.collectionName,
                  [...fields.map(f => Query.equal(mapColumnName(f), item[f])), Query.limit(2)]);
                if (existing.total > 1) throw new Error('Conflict columns match multiple records');
                id = existing.documents[0]?.$id;
              } catch (_) {
                // If conflict index doesn't exist, proceed with new creation
              }
            }
            const payload = sanitizeDocForSave(item);
            if (kind === 'upsert' && id) {
              try {
                docs.push(await databases.updateDocument(DATABASE_ID, this.collectionName, id, payload));
                continue;
              } catch (error: any) { if (error.code !== 404) throw error; }
            }
            docs.push(await databases.createDocument(DATABASE_ID, this.collectionName, id || ID.unique(), payload));
          }
        } else {
          const matched = await this.readDocuments(true);
          for (const doc of matched.documents) {
            if (kind === 'update') docs.push(await databases.updateDocument(DATABASE_ID, this.collectionName, doc.$id, sanitizeDocForSave(data)));
            else { await databases.deleteDocument(DATABASE_ID, this.collectionName, doc.$id); docs.push(doc); }
          }
        }
        count = docs.length;
      }
      docs = docs.map(normalizeDoc);
      if (this.headOnly && !this.mutation) return { data: null, error: null, count };
      if (this.isSingle || this.isMaybeSingle) {
        if (docs.length > 1 || (this.isSingle && !docs.length))
          return { data: null, error: { code: 'PGRST116', message: 'Expected exactly one matching record' }, count };
        return { data: docs[0] || null, error: null, count };
      }
      return { data: docs, error: null, count };
    } catch (error: any) { return { data: null, error }; }
  }

  private execute(): Promise<any> {
    this.resultPromise ??= this.run();
    return this.resultPromise;
  }

  then<TResult1 = { data: T | null; error: any; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: T | null; error: any; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// Resilient Auth Client
class AppwriteAuthClient {
  private authListeners: Set<(event: string, session: any) => void> = new Set();
  private cachedUser: any = null;
  private userRequest: Promise<any> | null = null;
  private last401Time = 0;

  private getAccount(): Promise<any> {
    // If recently verified unauthenticated (within 4 seconds), skip redundant 401 network requests
    if (Date.now() - this.last401Time < 4000) {
      return Promise.reject({ code: 401, message: 'Unauthenticated session' });
    }
    // All mounted listeners share the same in-flight account request.
    if (!this.userRequest) {
      this.userRequest = account.get()
        .then((u) => {
          this.last401Time = 0;
          return u;
        })
        .catch((err) => {
          if (err?.code === 401 || err?.message?.includes('missing scope') || err?.message?.includes('unauthorized')) {
            this.last401Time = Date.now();
          }
          throw err;
        })
        .finally(() => {
          this.userRequest = null;
        });
    }
    return this.userRequest;
  }

  constructor() {
    this.initSessionCheck();
  }

  private async initSessionCheck() {
    try {
      const u = await this.getAccount();
      this.cachedUser = this.formatUser(u);
      this.saveLocalAuth(this.cachedUser);
    } catch (_) {
      this.cachedUser = null;
      this.saveLocalAuth(null);
    }
  }

  private loadLocalAuth(): any {
    try {
      if (typeof localStorage !== 'undefined') {
        const item = localStorage.getItem('presences_auth_user');
        return item ? JSON.parse(item) : null;
      }
    } catch {
      // Safe fallback
    }
    return null;
  }

  private saveLocalAuth(user: any) {
    try {
      if (typeof localStorage !== 'undefined') {
        if (user) localStorage.setItem('presences_auth_user', JSON.stringify(user));
        else localStorage.removeItem('presences_auth_user');
      }
    } catch {
      // Safe fallback
    }
  }

  private formatUser(u: any): any {
    if (!u) return null;
    const isSuperAdmin = (u.labels || []).includes('admin') || (u.labels || []).includes('superadmin');
    return {
      id: u.$id || u.id || 'admin_user',
      email: u.email || 'admin@presences.dev',
      phone: u.phone,
      email_confirmed_at: u.emailVerification ? u.$updatedAt : new Date().toISOString(),
      user_metadata: {
        name: u.name || 'School Principal',
        ...(u.prefs || {}),
        role: isSuperAdmin ? 'admin' : 'user',
      },
      app_metadata: { role: isSuperAdmin ? 'admin' : 'user', labels: u.labels || [] },
      created_at: u.$createdAt || new Date().toISOString(),
      updated_at: u.$updatedAt || new Date().toISOString()
    };
  }

  async getUser(): Promise<{ data: { user: any }; error: any }> {
    try {
      const u = await this.getAccount();
      this.cachedUser = this.formatUser(u);
      this.saveLocalAuth(this.cachedUser);
      return { data: { user: this.cachedUser }, error: null };
    } catch (err: any) {
      this.cachedUser = null;
      this.saveLocalAuth(null);
      return { data: { user: null }, error: err.code === 401 ? null : err };
    }
  }

  async getSession(): Promise<{ data: { session: any }; error: any }> {
    try {
      const u = await this.getAccount();
      const user = this.formatUser(u);
      this.saveLocalAuth(user);
      return {
        data: {
          session: user ? { user, access_token: 'appwrite-active-session', expires_at: 9999999999 } : null
        },
        error: null
      };
    } catch (error: any) {
      this.cachedUser = null;
      this.saveLocalAuth(null);
      return { data: { session: null }, error: error.code === 401 ? null : error };
    }
  }

  async signInWithPassword({ email, password }: { email: string; password: string }): Promise<{ data: any; error: any }> {
    this.last401Time = 0;
    try {
      await account.createEmailPasswordSession(email.trim().toLowerCase(), password);
      const user = this.formatUser(await account.get());
      this.cachedUser = user;
      this.saveLocalAuth(user);
      const session = { user, access_token: 'appwrite-active-session' };
      this.notifyListeners('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    } catch (error: any) { return { data: null, error }; }
  }

  async signInWithOAuth({ provider, options }: { provider: string; options?: { redirectTo?: string } }) {
    this.last401Time = 0;
    try {
      const supported = { google: OAuthProvider.Google, github: OAuthProvider.Github, apple: OAuthProvider.Apple, azure: OAuthProvider.Microsoft, facebook: OAuthProvider.Facebook };
      const selected = supported[provider as keyof typeof supported];
      if (!selected) throw new Error('Unsupported sign-in provider');
      const redirect = options?.redirectTo || window.location.origin + '/login';
      await account.createOAuth2Session(selected, redirect, redirect);
      return { data: { url: redirect }, error: null };
    } catch (error: any) { return { data: null, error }; }
  }

  async signUp({ email, password, options }: { email: string; password: string; options?: any }): Promise<{ data: any; error: any }> {
    this.last401Time = 0;
    try {
      await account.create(ID.unique(), email.trim(), password, options?.data?.name || options?.data?.full_name || email.split('@')[0]);
      return this.signInWithPassword({ email, password });
    } catch (error: any) { return { data: null, error }; }
  }

  async signOut(_options?: any): Promise<{ error: any }> {
    try {
      await account.deleteSession('current');
    } catch (error: any) { if (error.code !== 401) return { error }; }
    this.cachedUser = null;
    this.saveLocalAuth(null);
    this.notifyListeners('SIGNED_OUT', null);
    return { error: null };
  }

  async refreshSession(): Promise<{ data: { session: any }; error: any }> {
    return this.getSession();
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this.authListeners.add(callback);
    this.getSession().then(({ data }) => {
      if (this.authListeners.has(callback)) callback('INITIAL_SESSION', data.session);
    });
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.authListeners.delete(callback);
          }
        }
      }
    };
  }

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }): Promise<{ data: any; error: any }> {
    try {
      const redirect = options?.redirectTo || (typeof window !== 'undefined' ? window.location.origin : '');
      const res = await account.createRecovery(email, redirect);
      return { data: res, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async updateUser(attributes: any): Promise<{ data: { user: any }; error: any }> {
    try {
      if (attributes.data?.name) {
        await account.updateName(attributes.data.name);
      }
      const u = await account.get();
      this.cachedUser = this.formatUser(u);
      this.saveLocalAuth(this.cachedUser);
      return { data: { user: this.cachedUser }, error: null };
    } catch (err: any) {
      return { data: { user: null }, error: err };
    }
  }

  private notifyListeners(event: string, session: any) {
    this.authListeners.forEach(cb => {
      try {
        cb(event, session);
      } catch (err) {
        console.error('[AppwriteAuth] listener error:', err);
      }
    });
  }
}

// Storage Bridge Implementation
class AppwriteStorageBucketClient {
  private bucketId: string;

  constructor(bucketId: string) {
    this.bucketId = bucketId;
  }

  getPublicUrl(path: string, options?: { transform?: ImageTransformOptions }): { data: { publicUrl: string } } {
    const fileId = storageFileId(path);
    if (options?.transform) {
      return {
        data: {
          publicUrl: getAppwriteStoragePreviewUrl(this.bucketId, fileId, options.transform)
        }
      };
    }
    return {
      data: {
        publicUrl: getAppwriteStorageViewUrl(this.bucketId, fileId)
      }
    };
  }

  async createSignedUrl(path: string, _expiresIn = 3600, options?: { transform?: ImageTransformOptions }): Promise<{ data: { signedUrl: string } | null; error: any }> {
    const fileId = storageFileId(path);
    if (options?.transform) {
      return {
        data: {
          signedUrl: getAppwriteStoragePreviewUrl(this.bucketId, fileId, options.transform)
        },
        error: null
      };
    }
    return {
      data: {
        signedUrl: getAppwriteStorageViewUrl(this.bucketId, fileId)
      },
      error: null
    };
  }

  async upload(path: string, fileBody: File | Blob | ArrayBuffer, _options?: any): Promise<{ data: any; error: any }> {
    try {
      const fileId = storageFileId(path) || ID.unique();
      let file: File;
      if (fileBody instanceof File) {
        file = fileBody;
      } else if (fileBody instanceof Blob) {
        file = new File([fileBody], path.split('/').pop() || 'upload.bin', { type: fileBody.type || 'application/octet-stream' });
      } else {
        file = new File([fileBody], path.split('/').pop() || 'upload.bin');
      }

      const res = await storage.createFile(
        this.bucketId,
        fileId,
        file,
        undefined
      );
      return { data: { ...res, id: res.$id, path }, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }

  async download(path: string): Promise<{ data: Blob | null; error: any }> {
    try {
      const fileId = storageFileId(path);
      const url = getAppwriteStorageDownloadUrl(this.bucketId, fileId);
      const res = await fetch(url);
      if (!res.ok) throw new Error('Storage download failed: ' + res.status);
      const blob = await res.blob();
      return { data: blob, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message } };
    }
  }

  async remove(paths: string[]): Promise<{ data: any; error: any }> {
    try {
      for (const path of paths) {
        const fileId = storageFileId(path);
        try {
          await storage.deleteFile(this.bucketId, fileId);
        } catch (error: any) {
          if (error?.code !== 404) throw error;
        }
      }
      return { data: paths, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message } };
    }
  }
}

class AppwriteStorageClient {
  from(bucketId: string) {
    const mappedBucket = APPWRITE_CONFIG.buckets[bucketId as keyof typeof APPWRITE_CONFIG.buckets] || bucketId;
    return new AppwriteStorageBucketClient(mappedBucket);
  }
}

// Realtime Channel Bridge
class AppwriteRealtimeChannel {
  private channelName: string;
  private unsubscribeFns: Array<() => void> = [];
  private presenceListeners: Array<{ event: string; callback: (payload: any) => void }> = [];
  private presences: Record<string, any[]> = {};
  private presenceId = '';
  private presencePayload: Record<string, any> = {};
  private presenceSubscription: Promise<any> | null = null;
  private disposed = false;

  constructor(channelName: string) {
    this.channelName = channelName;
  }

  on(event: string, filter: any, callback: (payload: any) => void): this {
    if (event === 'broadcast') {
      const unsubscribe = appwriteClient.subscribe(`databases.${DATABASE_ID}.collections.realtime_messages.documents`, response => {
        const message = normalizeDoc(response.payload);
        if (this.disposed || message.channel !== this.channelName || message.event !== filter?.event) return;
        if (response.events.some(e => e.endsWith('.delete')) || Date.parse(message.expires_at) < Date.now()) return;
        callback({ type: 'broadcast', event: message.event, payload: message.payload });
      });
      this.unsubscribeFns.push(unsubscribe);
      return this;
    }
    if (event === 'presence') {
      this.presenceListeners.push({ event: filter?.event || 'sync', callback });
      if (!this.presenceSubscription) {
        this.presenceSubscription = realtime.subscribe(Channel.presences(), response => {
          const record = response.payload;
          if (this.disposed || record.metadata?.channel !== this.channelName) return;
          const key = record.$id;
          const previous = this.presences[key];
          const removed = response.events.some(e => e.endsWith('.delete')) || record.status === 'offline';
          if (removed) delete this.presences[key];
          else this.presences[key] = [record.metadata?.payload || {}];
          for (const listener of this.presenceListeners) {
            if (listener.event === 'sync') listener.callback({});
            if (!previous && !removed && listener.event === 'join') listener.callback({ key, newPresences: this.presences[key] });
            if (previous && removed && listener.event === 'leave') listener.callback({ key, leftPresences: previous });
          }
        }).then(subscription => {
          if (this.disposed) void subscription.unsubscribe();
          else this.unsubscribeFns.push(() => { void subscription.unsubscribe(); });
          return subscription;
        });
        this.presenceSubscription.catch(error => console.warn('[Realtime] Presence unavailable:', error?.message));
      }
      return this;
    }
    if (event === 'postgres_changes' || event === 'system') {
      const table = filter?.table || '*';
      const channelTopic = table === '*'
        ? `databases.${DATABASE_ID}.collections`
        : `databases.${DATABASE_ID}.collections.${table}.documents`;

      try {
        const unsub = appwriteClient.subscribe(channelTopic, (response) => {
          const payload = {
            schema: 'public',
            table: table,
            commit_timestamp: new Date().toISOString(),
            eventType: response.events.some(e => e.includes('.create')) ? 'INSERT'
              : response.events.some(e => e.includes('.update')) ? 'UPDATE' : 'DELETE',
            new: normalizeDoc(response.payload),
            old: normalizeDoc(response.payload),
            errors: null
          };
          if (filter?.event && filter.event !== '*' && filter.event !== payload.eventType) return;
          if (filter?.filter) {
            const match = String(filter.filter).match(/^([^.]+)=eq\.(.+)$/);
            if (match && String(payload.new?.[match[1]]) !== match[2]) return;
          }
          callback(payload);
        });
        this.unsubscribeFns.push(unsub);
      } catch (err) {
        // Safe silent failover for realtime
      }
    }
    return this;
  }

  subscribe(statusCallback?: (status: string) => void): this {
    this.disposed = false;
    if (statusCallback) {
      if (this.presenceSubscription) {
        this.presenceSubscription.then(() => { if (!this.disposed) return statusCallback('SUBSCRIBED'); })
          .catch(() => { if (!this.disposed) statusCallback('CHANNEL_ERROR'); });
      } else setTimeout(() => { if (!this.disposed) statusCallback('SUBSCRIBED'); }, 50);
    }
    return this;
  }

  presenceState<T = any>(): Record<string, T[]> { return { ...this.presences }; }

  async track(payload: Record<string, any>): Promise<void> {
    try {
      const user = await account.get();
      if (!user?.$id) return;
      if (!this.presenceId) this.presenceId = storageFileId(this.channelName + '/' + crypto.randomUUID());
      this.presencePayload = { ...this.presencePayload, ...payload };
      await realtime.upsertPresence({
        presenceId: this.presenceId,
        status: 'online',
        permissions: [Permission.read(Role.user(user.$id)), Permission.read(Role.label('admin')), Permission.read(Role.label('principal'))],
        metadata: { channel: this.channelName, payload: this.presencePayload },
      });
    } catch {
      // Graceful fallback when unauthenticated
    }
  }

  async untrack(): Promise<void> {
    if (this.presenceId) await realtime.upsertPresence({ presenceId: this.presenceId, status: 'offline', metadata: { channel: this.channelName } });
  }

  async send(message: { type: string; event: string; payload: any }): Promise<string> {
    const result = await new AppwriteFunctionsBridge().invoke('presences-backend', { body: { action: 'realtime.send', channel: this.channelName, ...message } });
    if (result.error) throw result.error;
    return 'ok';
  }

  unsubscribe(): void {
    this.disposed = true;
    void this.untrack().catch(() => {});
    this.unsubscribeFns.forEach(unsub => {
      try {
        unsub();
      } catch (_) {}
    });
    this.unsubscribeFns = [];
  }
}

// Functions Invocation Bridge
class AppwriteFunctionsBridge {
  async invoke(functionName: string, options?: { body?: any; headers?: Record<string, string> }): Promise<{ data: any; error: any }> {
    try {
      const bodyStr = typeof options?.body === 'string' ? options.body : JSON.stringify(options?.body || {});
      const execution = await functions.createExecution(
        functionName,
        bodyStr,
        false,
        '/',
        'POST' as any,
        options?.headers || {}
      );
      if (execution.status === 'failed' || execution.responseStatusCode >= 400) {
        return { data: null, error: { message: execution.responseBody || 'Appwrite function execution failed', code: execution.responseStatusCode } };
      }
      let responseBody = execution.responseBody;
      try {
        responseBody = JSON.parse(responseBody);
      } catch (_) {}
      return { data: responseBody, error: null };
    } catch (err: any) {
      return { data: null, error: err };
    }
  }
}

// Unified Client Instance
export class AppwriteUnifiedClient {
  public auth = new AppwriteAuthClient();
  public storage = new AppwriteStorageClient();
  public functions = new AppwriteFunctionsBridge();
  private channels = new Map<string, AppwriteRealtimeChannel>();

  from<T = any>(collectionName: string): AppwriteQueryBuilder<T> {
    return new AppwriteQueryBuilder<T>(collectionName);
  }

  channel(channelName: string, _opts?: any): AppwriteRealtimeChannel {
    if (!this.channels.has(channelName)) {
      this.channels.set(channelName, new AppwriteRealtimeChannel(channelName));
    }
    return this.channels.get(channelName)!;
  }

  removeChannel(channel: any): void {
    if (channel && typeof channel.unsubscribe === 'function') {
      channel.unsubscribe();
      for (const [name, registered] of this.channels) if (registered === channel) this.channels.delete(name);
    }
  }

  getChannels(): any[] {
    return Array.from(this.channels.values());
  }

  async rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    if (['upsert_class_attendance_event', 'get_all_auth_users', 'trigger_auto_backup'].includes(fnName)) {
      return this.functions.invoke('presences-backend', { body: { action: fnName, ...params } });
    }
    return this.functions.invoke(fnName, { body: params });
  }
}

export const appwriteUnifiedClient = new AppwriteUnifiedClient();
export default appwriteUnifiedClient;
