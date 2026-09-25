import { MediaLibrary } from '@/cms/admin';
import { countMedia, listMedia } from '@/cms/core/media/service';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

export default async function MediaPage() {
  const user = await requirePerm(PERMISSIONS.mediaRead);
  const [items, total] = await Promise.all([listMedia(), countMedia()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Media</h1>
      <MediaLibrary
        initial={JSON.parse(JSON.stringify(items))}
        // Known on the server already, so the count is right on the first paint rather
        // than appearing only after the grid fetches for itself.
        initialTotal={total}
        // Alt text, upload and delete are all `mediaWrite` on the API; a reader is
        // shown the library without controls that would only be refused.
        canWrite={hasPerm(user.permissions, PERMISSIONS.mediaWrite)}
      />
    </div>
  );
}
