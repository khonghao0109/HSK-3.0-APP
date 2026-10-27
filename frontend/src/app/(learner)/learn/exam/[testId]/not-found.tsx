import Link from 'next/link';

/** Missing, unready or malformed exam test id (TL-119(d)). */
export default function ExamIntroNotFound() {
  return (
    <main className="ex exi exi-nf">
      <div className="exi-nf__body">
        <h1 className="exi-nf__title">Không tìm thấy đề thi</h1>
        <p className="exi-nf__text">Đề thi này không tồn tại hoặc chưa mở.</p>
        <Link className="btn btn--primary" href="/learn">
          Về trang học
        </Link>
      </div>
    </main>
  );
}
