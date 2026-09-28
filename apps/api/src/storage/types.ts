export interface ObjectInfo {
  sizeBytes: number;
  contentType?: string;
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
  deleteObjects(keys: string[]): Promise<void>;
}
