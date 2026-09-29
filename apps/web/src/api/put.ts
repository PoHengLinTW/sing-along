/** PUT a file to a presigned URL. XHR, not fetch: only XHR reports upload progress. */
export function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Upload cancelled', 'AbortError');
    if (signal?.aborted) return reject(abortError());

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    // Content-Length is set by the browser from the body: the URL was signed with exactly this size.
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Can't reach storage."));
    xhr.onabort = () => reject(abortError());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
