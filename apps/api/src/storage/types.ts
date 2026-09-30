export interface ObjectInfo {
  sizeBytes: number;
  contentType?: string;
}

export interface ListedObject {
  key: string;
  sizeBytes: number;
  lastModified: Date;
}

/** Object storage the API talks to (R2 in prod, RustFS in dev). Audio never flows through the API. */
export interface Storage {
  /** Presigned PUT bound to this exact Content-Type and Content-Length. */
  presignPut(opts: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSec: number;
  }): Promise<string>;
  presignGet(opts: { key: string; expiresInSec: number }): Promise<string>;
  /** null when the object doesn't exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Throws if any key could not be deleted; deleting a missing key is not an error. */
  deleteObjects(keys: string[]): Promise<void>;
  /** Every object whose key starts with `prefix` (all pages). */
  list(prefix: string): Promise<ListedObject[]>;
}
