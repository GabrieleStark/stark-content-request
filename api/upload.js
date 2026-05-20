// api/upload.js — PUT /api/upload?filename=xxx
// Stores the file in Vercel Blob and returns its public URL.
// Requires env var: BLOB_READ_WRITE_TOKEN  (set in Vercel project settings)

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end();

  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'Missing filename' });

  // Lazy-import so the module is only required when the token is configured
  let put;
  try {
    ({ put } = await import('@vercel/blob'));
  } catch {
    return res.status(503).json({ error: 'File storage not configured' });
  }

  try {
    const blob = await put(filename, req, {
      access: 'private',
    });
    // downloadUrl is a pre-signed URL accessible to anyone with the link
    return res.status(200).json({ url: blob.downloadUrl || blob.url });
  } catch (err) {
    console.error('[upload] Blob error:', err.message);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
