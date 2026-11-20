/**
 * Q360 (PO 20/11/2026): mật khẩu mới (đăng ký, đặt lại) tối thiểu 8 ký tự theo
 * NIST SP 800-63B. Đăng nhập vẫn nhận từ 6 ký tự để tài khoản tạo trước Q360
 * (mật khẩu 6–7 ký tự) không bị khoá ngoài.
 */
export const NEW_PASSWORD_MIN_LENGTH = 8;
export const LOGIN_PASSWORD_MIN_LENGTH = 6;
