-- Chat images storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-images',
  'chat-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "chat_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-images');

-- Allow insert (service role / anon)
CREATE POLICY "chat_images_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-images');

-- Allow delete own objects
CREATE POLICY "chat_images_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-images');
