import Link from 'next/link';

/** Missing or malformed attempt id (TL-144). */
export default function ExamAttemptNotFound() {
  return (
    <main className="ex ext ext-nf">
      <div className="ext-nf__body">
        <h1 className="ext-nf__title">Không tìm thấy bài thi</h1>
        <p className="ext-nf__text">
          Bài thi này không tồn tại hoặc không thuộc tài khoản của bạn.
        </p>
        <Link className="btn btn--primary" href="/learn">
          Về trang học
        </Link>
      </div>
    </main>
  );
}
