import Link from 'next/link';

export default function MediaNotFound() {
  return (
    <div className="adm-state-card">
      <h1>Không tìm thấy media</h1>
      <p>Media không tồn tại hoặc không còn truy cập được.</p>
      <div className="adm-state-card__actions">
        <Link className="adm-btn adm-btn--primary" href="/admin/media">
          Về thư viện media
        </Link>
      </div>
    </div>
  );
}
