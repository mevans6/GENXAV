import { checked, db, type EmailAttachment, HttpError } from './server';
export const CONSULTING_BUCKET = 'consulting-attachments';

export function intakeEmailText(request: {
  id: string; name: string; email: string; phone: string; location: string;
  need: string; description: string; created_at: string;
}, filenames: string[]) {
  return [
    'New Gen X AV consulting request',
    `Reference: ${request.id}`,
    `Submitted: ${request.created_at}`,
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    `Phone: ${request.phone || 'Not provided'}`,
    `City and state: ${request.location}`,
    `Help requested: ${request.need}`,
    '', 'Situation:', request.description,
    '', `Attachments: ${filenames.length ? filenames.join(', ') : 'None'}`,
    '', `Review this request: ${process.env.NEXT_PUBLIC_SITE_URL}/consulting/admin`,
  ].join('\n');
}

export async function intakeEmailAttachments(requestId: string): Promise<EmailAttachment[]> {
  // Only files already linked to this saved request can be emailed. No public URLs.
  const files = checked(await db().from('consulting_attachments')
    .select('filename,storage_path,bytes')
    .eq('request_id', requestId).gt('expires_at', new Date().toISOString())
    .order('created_at'));
  if (files.length > 6) throw new HttpError(503, 'Too many intake attachments.');
  const attachments: EmailAttachment[] = [];
  for (const file of files) {
    const blob = checked(await db().storage.from(CONSULTING_BUCKET).download(file.storage_path));
    if (blob.size > 3 * 1024 * 1024 || blob.size !== file.bytes)
      throw new HttpError(503, 'An intake attachment could not be verified.');
    attachments.push({
      filename: file.filename.replace(/[^a-zA-Z0-9 ._()-]/g, '_').slice(0, 140) || 'attachment',
      content: Buffer.from(await blob.arrayBuffer()).toString('base64'),
    });
  }
  return attachments;
}
