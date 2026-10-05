export const LEARNER_AUTH_ERROR_MESSAGES = {
  invalidCredentials: 'Email hoặc mật khẩu không đúng.',
  accountLocked:
    'Tài khoản tạm khoá do đăng nhập sai nhiều lần. Vui lòng thử lại sau.',
  adminAccount:
    'Tài khoản này không dùng để học. Hãy đăng nhập bằng tài khoản học viên.',
  emailTaken: 'Email này đã được đăng ký.',
  weakPassword: 'Mật khẩu quá dễ đoán. Hãy chọn mật khẩu khác.',
  rateLimited: 'Bạn thao tác quá nhanh. Đợi một lát rồi thử lại.',
  generic: 'Không thực hiện được lúc này. Vui lòng thử lại.',
  network: 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.',
  invalidEmail: 'Vui lòng nhập email hợp lệ.',
  shortPassword: 'Mật khẩu cần ít nhất 6 ký tự.',
  email: 'Vui lòng nhập email hợp lệ.',
  password: 'Mật khẩu cần ít nhất 6 ký tự.',
} as const;
