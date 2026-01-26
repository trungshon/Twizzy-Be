export const USER_MESSAGES = {
  GMAIL_NOT_VERIFIED: 'Gmail chưa được xác nhận',
  GOOGLE_ID_TOKEN_IS_REQUIRED: 'Google ID token không được để trống',
  GOOGLE_ID_TOKEN_IS_INVALID: 'Google ID token không hợp lệ',
  GOOGLE_LOGIN_SUCCESSFULLY: 'Đăng nhập bằng Google thành công',
  VALIDATION_ERROR: 'Validation error',
  NAME_IS_REQUIRED: 'Tên không được để trống',
  NAME_MUST_BE_A_STRING: 'Tên phải là một chuỗi',
  NAME_MUST_BE_FROM_1_TO_100_CHARACTERS: 'Tên phải có từ 1 đến 100 ký tự',
  EMAIL_ALREADY_EXISTS: 'Email đã tồn tại',
  EMAIL_IS_REQUIRED: 'Email không được để trống',
  EMAIL_MUST_BE_A_VALID_EMAIL: 'Email không hợp lệ',
  EMAIL_OR_PASSWORD_IS_INCORRECT: 'Email hoặc mật khẩu không chính xác',
  PASSWORD_IS_REQUIRED: 'Mật khẩu không được để trống',
  PASSWORD_MUST_BE_A_STRING: 'Mật khẩu phải là một chuỗi',
  PASSWORD_MUST_BE_FROM_6_TO_50_CHARACTERS: 'Mật khẩu phải có từ 6 đến 50 ký tự',
  PASSWORD_MUST_BE_STRONG:
    'Mật khẩu phải có ít nhất 6 ký tự và chứa ít nhất một chữ cái viết hoa, một chữ cái viết thường, một số và một ký tự đặc biệt',
  CONFIRM_PASSWORD_IS_REQUIRED: 'Xác nhận mật khẩu không được để trống',
  CONFIRM_PASSWORD_MUST_BE_A_STRING: 'Xác nhận mật khẩu phải là một chuỗi',
  CONFIRM_PASSWORD_MUST_BE_FROM_6_TO_50_CHARACTERS: 'Xác nhận mật khẩu phải có từ 6 đến 50 ký tự',
  CONFIRM_PASSWORD_MUST_BE_STRONG:
    'Xác nhận mật khẩu phải có ít nhất 6 ký tự và chứa ít nhất một chữ cái viết hoa, một chữ cái viết thường, một số và một ký tự đặc biệt',
  CONFIRM_PASSWORD_MUST_BE_THE_SAME: 'Xác nhận mật khẩu và mật khẩu phải giống nhau',
  DATE_OF_BIRTH_IS_REQUIRED: 'Ngày sinh không được để trống',
  DATE_OF_BIRTH_MUST_BE_ISO8601: 'Ngày sinh không hợp lệ',
  LOGIN_SUCCESSFULLY: 'Đăng nhập thành công',
  REGISTER_SUCCESSFULLY: 'Đăng ký thành công',
  AUTHORIZATION_IS_REQUIRED: 'Authorization không được để trống',
  ACCESS_TOKEN_IS_REQUIRED: 'Access token không được để trống',
  LOGOUT_SUCCESSFULLY: 'Đăng xuất thành công',
  LOGOUT_FAILED: 'Đăng xuất thất bại',
  REFRESH_TOKEN_IS_REQUIRED: 'Refresh token không được để trống',
  REFRESH_TOKEN_IS_INVALID: 'Refresh token không hợp lệ',
  USED_REFRESH_TOKEN_OR_NOT_EXISTS: 'Refresh token đã sử dụng hoặc không tồn tại',
  REFRESH_TOKEN_SUCCESSFULLY: 'Refresh token thành công',
  EMAIL_VERIFY_TOKEN_IS_REQUIRED: 'Email verify token không được để trống',
  EMAIL_VERIFY_TOKEN_IS_INVALID: 'Email verify token không hợp lệ',
  EMAIL_VERIFY_TOKEN_OR_NOT_EXISTS: 'Email verify token không tồn tại',
  EMAIL_VERIFY_SUCCESSFULLY: 'Xác nhận email thành công',
  USER_NOT_FOUND: 'Người dùng không tồn tại',
  EMAIL_ALREADY_VERIFIED: 'Email đã được xác nhận',
  RESEND_VERIFY_EMAIL_SUCCESSFULLY: 'Gửi lại email xác nhận thành công',
  CHECK_EMAIL_FOR_RESET_PASSWORD: 'Kiểm tra email để đặt lại mật khẩu',
  FORGOT_PASSWORD_TOKEN_IS_REQUIRED: 'Forgot password token không được để trống',
  FORGOT_PASSWORD_TOKEN_IS_INVALID: 'Forgot password token không hợp lệ',
  VERIFY_FORGOT_PASSWORD_SUCCESSFULLY: 'Xác nhận đặt lại mật khẩu thành công',
  RESET_PASSWORD_SUCCESSFULLY: 'Đặt lại mật khẩu thành công',
  GET_ME_SUCCESSFULLY: 'Lấy thông tin cá nhân thành công',
  UPDATE_ME_SUCCESSFULLY: 'Cập nhật thông tin cá nhân thành công',
  GET_PROFILE_SUCCESSFULLY: 'Lấy thông tin người dùng thành công',
  USER_NOT_VERIFIED: 'Người dùng chưa được xác nhận',
  BIO_MUST_BE_A_STRING: 'Bio phải là một chuỗi',
  BIO_MUST_BE_FROM_1_TO_200_CHARACTERS: 'Bio phải có từ 1 đến 200 ký tự',
  LOCATION_MUST_BE_A_STRING: 'Địa chỉ phải là một chuỗi',
  LOCATION_MUST_BE_FROM_1_TO_200_CHARACTERS: 'Địa chỉ phải có từ 1 đến 200 ký tự',
  WEBSITE_MUST_BE_A_STRING: 'Website phải là một chuỗi',
  WEBSITE_MUST_BE_FROM_1_TO_200_CHARACTERS: 'Website phải có từ 1 đến 200 ký tự',
  USERNAME_MUST_BE_A_STRING: 'Username phải là một chuỗi',
  USERNAME_CAN_ONLY_BE_CHANGED_ONCE: 'Username chỉ được thay đổi một lần duy nhất',
  USERNAME_INVALID:
    'Username phải có từ 4 đến 15 ký tự và chỉ chứa chữ cái, số, dấu gạch dưới và không được chỉ chứa số',
  USERNAME_EXISTED: 'Username đã tồn tại',
  IMAGE_URL_MUST_BE_A_STRING: 'Image URL phải là một chuỗi',
  IMAGE_URL_MUST_BE_FROM_1_TO_400_CHARACTERS: 'Image URL phải có từ 1 đến 400 ký tự',
  INVALID_USER_ID: 'ID người dùng không hợp lệ',
  // OTP messages
  OTP_IS_REQUIRED: 'OTP không được để trống',
  OTP_MUST_BE_A_STRING: 'OTP phải là một chuỗi',
  OTP_MUST_BE_6_DIGITS: 'OTP phải có 6 chữ số',
  OTP_IS_INVALID: 'OTP không hợp lệ hoặc đã hết hạn',
  OTP_EXPIRED: 'OTP đã hết hạn',
  OTP_VERIFY_SUCCESSFULLY: 'OTP xác nhận thành công',
  OTP_SENT_SUCCESSFULLY: 'OTP đã được gửi thành công đến email của bạn',
  FOLLOW_SUCCESSFULLY: 'Theo dõi người dùng thành công',
  FOLLOWED_ALREADY: 'Đã theo dõi người dùng này',
  ALREADY_UNFOLLOWED: 'Bạn chưa theo dõi người dùng này',
  UNFOLLOW_SUCCESSFULLY: 'Hủy theo dõi người dùng thành công',
  OLD_PASSWORD_IS_INCORRECT: 'Mật khẩu cũ không chính xác',
  NEW_PASSWORD_MUST_BE_DIFFERENT: 'Mật khẩu mới phải khác mật khẩu cũ',
  CHANGE_PASSWORD_SUCCESSFULLY: 'Đổi mật khẩu thành công',
  UPLOAD_IMAGE_SUCCESSFULLY: 'Tải lên ảnh thành công',
  UPLOAD_VIDEO_SUCCESSFULLY: 'Tải lên video thành công',
  GET_FOLLOWERS_SUCCESSFULLY: 'Lấy danh sách người theo dõi thành công',
  GET_FOLLOWING_SUCCESSFULLY: 'Lấy danh sách đang theo dõi thành công'
} as const

export const TWIZZ_MESSAGES = {
  GET_NEW_FEEDS_SUCCESSFULLY: 'Lấy new feeds thành công',
  TWIZZ_IS_NOT_PUBLIC: 'Bài viết không phải là bài viết công khai',
  GET_TWIZZ_SUCCESSFULLY: 'Lấy bài viết thành công',
  GET_TWIZZ_CHILDREN_SUCCESSFULLY: 'Lấy bài viết con thành công',
  INVALID_TWIZZ_ID: 'ID bài viết không hợp lệ',
  TWIZZ_NOT_EXISTS: 'Bài viết không tồn tại',
  CREATE_TWIZZ_SUCCESSFULLY: 'Tạo bài viết thành công',
  CREATE_TWIZZ_FAILED: 'Tạo bài viết thất bại',
  DELETE_TWIZZ_SUCCESSFULLY: 'Xóa bài viết thành công',
  DELETE_TWIZZ_FAILED: 'Xóa bài viết thất bại',
  CANNOT_DELETE_TWIZZ: 'Bạn chỉ có thể xóa bài viết của chính mình',
  INVALID_TYPE: 'Loại bài viết không hợp lệ',
  INVALID_AUDIENCE: 'Đối tượng của bài viết không hợp lệ',
  INVALID_PARENT_ID: 'ID bài viết cha không hợp lệ',
  PARENT_ID_MUST_BE_NULL: 'ID bài viết cha phải là null',
  CONTENT_MUST_BE_A_NON_EMPTY_STRING: 'Nội dung phải là một chuỗi không rỗng',
  CONTENT_MUST_BE_AN_EMPTY_STRING: 'Nội dung phải là một chuỗi rỗng',
  HASHTAGS_MUST_BE_AN_ARRAY_OF_STRINGS: 'Hashtags phải là một mảng các chuỗi',
  MENTIONS_MUST_BE_AN_ARRAY_OF_USER_IDS: 'Mentions phải là một mảng các user_id',
  MEDIAS_MUST_BE_AN_ARRAY_OF_MEDIA_OBJECTS: 'Medias phải là một mảng các Media Object',
  INVALID_TWIZZ_TYPE: 'Loại bài viết không hợp lệ',
  LIMIT_MUST_BE_BETWEEN_1_AND_100: 'Số lượng bài viết con phải từ 1 đến 100',
  PAGE_MUST_BE_AT_LEAST_1: 'Trang phải lớn hơn hoặc bằng 1'
} as const

export const BOOKMARK_MESSAGES = {
  BOOKMARK_TWIZZ_SUCCESSFULLY: 'Đánh dấu bài viết thành công',
  BOOKMARK_TWIZZ_FAILED: 'Đánh dấu bài viết thất bại',
  UNBOOKMARK_TWIZZ_SUCCESSFULLY: 'Hủy đánh dấu bài viết thành công',
  UNBOOKMARK_TWIZZ_FAILED: 'Hủy đánh dấu bài viết thất bại'
} as const

export const LIKE_MESSAGES = {
  LIKE_TWIZZ_SUCCESSFULLY: 'Thích bài viết thành công',
  LIKE_TWIZZ_FAILED: 'Thích bài viết thất bại',
  UNLIKE_TWIZZ_SUCCESSFULLY: 'Hủy thích bài viết thành công',
  UNLIKE_TWIZZ_FAILED: 'Hủy thích bài viết thất bại'
} as const

export const SEARCH_MESSAGES = {
  SEARCH_SUCCESSFULLY: 'Tìm kiếm thành công',
  CONTENT_MUST_BE_A_STRING: 'Nội dung tìm kiếm phải là một chuỗi',
  MEDIA_TYPE_IS_INVALID: 'Loại media không hợp lệ',
  PEOPLE_FOLLOW_IS_INVALID: 'Tùy chọn người theo dõi không hợp lệ',
  SEARCH_TYPE_IS_INVALID: 'Loại tìm kiếm không hợp lệ (phải là "users" hoặc "twizzs")',
  SEARCH_FIELD_IS_INVALID: 'Trường tìm kiếm không hợp lệ (phải là "username" hoặc "name")'
} as const

export const CONVERSATION_MESSAGES = {
  GET_CONVERSATION_SUCCESSFULLY: 'Lấy cuộc trò chuyện thành công',
  GET_CONVERSATION_FAILED: 'Lấy cuộc trò chuyện thất bại'
} as const

