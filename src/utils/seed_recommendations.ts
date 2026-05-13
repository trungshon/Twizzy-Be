import { faker } from '@faker-js/faker'
import { ObjectId, Double } from 'mongodb'
import databaseService from '~/services/database.services'
import User from '~/models/schemas/User.schema'
import Hashtag from '~/models/schemas/Hashtag.schema'
import Twizz from '~/models/schemas/Twizz.schema'
import Like from '~/models/schemas/Like.schema'
import Follower from '~/models/schemas/Follower.schema'
import { hashPassword } from '~/utils/crypto'
import { TwizzAudience, TwizzType, UserVerifyStatus } from '~/constants/enum'
import embeddingService from '~/services/embedding.services'

/**
 * SEED DỮ LIỆU THỰC TẾ CHO HỆ THỐNG GỢI Ý (SEMANTIC VERSION)
 */

const SEED_TAG = 'seed_reco_2026'
const PASSWORD = 'Aa1!aaaa'

// Danh sách các chủ đề
const TOPICS = ['football', 'cooking', 'tech', 'movie', 'travel', 'music', 'finance', 'health', 'astronomy'] as const
type Topic = (typeof TOPICS)[number]

/**
 * THƯ VIỆN NỘI DUNG TIẾNG VIỆT THỰC TẾ
 * Mỗi chủ đề có đủ số lượng bài viết để không bị trùng lặp.
 */
const CONTENT_LIBRARY: Record<Topic | 'comments' | 'quotes', string[]> = {
  football: [
    "Trận Derby tối qua thực sự quá kịch tính, bàn thắng phút 90+5 làm cả sân vận động nổ tung! #football #derby",
    "Lịch thi đấu Ngoại hạng Anh tuần này có quá nhiều trận tâm điểm, không thể bỏ lỡ. #EPL",
    "Messi vẫn cho thấy đẳng cấp thiên tài dù đã bước sang sườn dốc sự nghiệp. #Messi #GOAT",
    "Đội tuyển Việt Nam cần có những thay đổi mạnh mẽ về lối chơi để cạnh tranh ở cấp độ châu lục.",
    "Thị trường chuyển nhượng mùa hè đang nóng lên với những bản hợp đồng bom tấn. #transfer",
    "Kỹ thuật kiểm soát bóng của các cầu thủ trẻ bây giờ thực sự ấn tượng. #footballskills",
    "Sơ đồ 3-4-3 đang trở thành xu hướng mới trong bóng đá hiện đại.",
    "Những pha cứu thua xuất thần của thủ môn đã giữ lại 1 điểm quý giá. #goalkeeper",
    "Công nghệ VAR vẫn gây ra nhiều tranh cãi trong các tình huống việt vị. #VAR #football",
    "Cầu thủ này có tốc độ xé gió, thực sự là nỗi khiếp sợ cho mọi hàng thủ.",
    "Sân vận động tối nay không còn một chỗ trống, không khí thật tuyệt vời. #stadium",
    "HLV vừa có những thay đổi nhân sự bước ngoặt giúp đội bóng lội ngược dòng. #tactics",
    "Chấn thương của tiền đạo chủ lực là tổn thất quá lớn cho đội bóng lúc này.",
    "Những quả đá phạt trực tiếp luôn là vũ khí lợi hại của đội trưởng.",
    "Tinh thần thi đấu quả cảm đã giúp đội bóng yếu hơn tạo nên bất ngờ. #motivation",
    "Review sân bóng cỏ nhân tạo mới ở khu vực Cầu Giấy, chất lượng khá ổn. #bongda",
    "Tầm quan trọng của việc đào tạo trẻ đối với sự phát triển bền vững của CLB.",
    "Phân tích lối chơi pressing tầm cao của các đội bóng hàng đầu châu Âu. #footballanalysis",
    "Những khoảnh khắc xúc động khi cầu thủ chia tay người hâm mộ.",
    "Dự đoán tỉ số trận chung kết Champions League tối nay, ai sẽ lên ngôi? #UCL",
    "Hàng phòng ngự hôm nay thi đấu quá lỏng lẻo, liên tục để lộ khoảng trống. #defense",
    "Sức mạnh của người hâm mộ là cầu thủ thứ 12 trên sân. #fans",
    "Những bài tập thể lực cường độ cao giúp cầu thủ duy trì phong độ.",
    "Sự trở lại của các trụ cột sau chấn thương là tin không thể vui hơn. #injuryupdate",
    "Bóng đá không chỉ là môn thể thao, đó là niềm đam mê bất tận. #passion",
    "Phân tích vai trò của tiền vệ trụ trong việc luân chuyển bóng.",
    "Những bàn thắng từ xa luôn mang lại cảm giác cực kỳ phấn khích. #goals",
    "Sự kết hợp giữa kinh nghiệm và sức trẻ đang mang lại thành công.",
    "Áp lực của việc đá luân lưu 11m thực sự là thử thách tâm lý cực đại.",
    "Bóng đá nữ Việt Nam đang ngày càng khẳng định vị thế trên bản đồ thế giới. #Vietnam"
  ],
  tech: [
    "Vừa trải nghiệm thử Vision Pro, cảm giác không gian thực tế ảo thực sự rất khác biệt. #VisionPro #Apple",
    "Lập trình Node.js cần nắm vững cơ chế Event Loop để tối ưu hiệu năng hệ thống. #nodejs #backend",
    "Chip M3 mới của Apple thực sự gây ấn tượng về hiệu suất trên mỗi watt điện. #M3Chip",
    "Trí tuệ nhân tạo (AI) đang thay đổi cách chúng ta viết code hàng ngày. #AI #Copilot",
    "Review chi tiết iPhone 15 Pro Max sau một tháng sử dụng thực tế. #iPhone15",
    "Cơ sở dữ liệu Vector là chìa khóa để xây dựng các hệ thống gợi ý thông minh. #VectorDB",
    "Xu hướng thiết kế giao diện (UI/UX) năm 2024 có gì mới? #UIUX",
    "Bảo mật thông tin là ưu tiên hàng đầu trong kỷ nguyên chuyển đổi số. #security",
    "Làm thế nào để tối ưu tốc độ load trang cho ứng dụng ReactJS? #ReactJS",
    "Tìm hiểu về kiến trúc Microservices và cách triển khai trên Docker. #Microservices",
    "Ngôn ngữ lập trình Rust đang ngày càng phổ biến nhờ tính an toàn bộ nhớ. #Rustlang",
    "Công nghệ 5G sẽ thúc đẩy sự phát triển của IoT như thế nào? #5G #IoT",
    "Hướng dẫn xây dựng API RESTful chuẩn chỉnh và dễ mở rộng. #API",
    "Sự khác biệt giữa SQL và NoSQL trong các bài toán thực tế.",
    "Tương lai của xe điện và các công nghệ pin thế hệ mới. #EV #tech",
    "ChatGPT và các mô hình ngôn ngữ lớn đang làm thay đổi ngành giáo dục.",
    "Cách thiết lập quy trình CI/CD hiệu quả cho team lập trình nhỏ. #CICD",
    "Tầm quan trọng của việc viết Unit Test trong phát triển phần mềm.",
    "Khám phá các tính năng mới trong bản cập nhật TypeScript mới nhất. #TypeScript",
    "Điện toán đám mây (Cloud Computing) giúp doanh nghiệp tiết kiệm chi phí. #Cloud",
    "Những sai lầm phổ biến của các lập trình viên mới vào nghề.",
    "Công nghệ Blockchain không chỉ là tiền ảo, nó còn nhiều ứng dụng hơn thế. #Blockchain",
    "Review bàn phím cơ cho lập trình viên, gõ cả ngày không mỏi tay. #MechanicalKeyboard",
    "Cách quản lý state hiệu quả trong các ứng dụng Flutter phức tạp. #Flutter",
    "Thị trường việc làm IT cuối năm 2024 đang có những biến động gì?",
    "Cybersecurity: Cách bảo vệ dữ liệu cá nhân trước các cuộc tấn công mạng.",
    "Sức mạnh của GPU trong việc huấn luyện các mô hình Machine Learning. #GPU #ML",
    "Hướng dẫn cài đặt và cấu hình Linux cho người mới bắt đầu. #Linux",
    "Mạng xã hội phi tập trung: Liệu có thay thế được các ông lớn hiện nay?",
    "Tối ưu hóa query trong MongoDB để xử lý hàng triệu bản ghi. #MongoDB",
    "Deep Learning vs Machine Learning: Đâu là sự khác biệt thực sự?",
    "Các công cụ hỗ trợ lập trình (IDE) tốt nhất hiện nay bạn nên thử. #VSCode",
    "Khám phá thế giới Quantum Computing - Máy tính lượng tử.",
    "Lợi ích của việc sử dụng Serverless Architecture trong dự án thực tế. #Serverless",
    "Review màn hình rời chuyên dụng cho đồ họa và lập trình.",
    "Cách xây dựng chatbot thông minh tích hợp vào website.",
    "Phân tích dữ liệu lớn (Big Data) giúp đưa ra quyết định kinh doanh chính xác. #BigData",
    "Những kiến thức cơ bản về mạng máy tính mà developer nào cũng cần biết.",
    "Tương lai của nghề Frontend Developer giữa cơn bão AI.",
    "Review các dòng laptop gaming giá rẻ nhưng cấu hình cực khủng. #GamingLaptop"
  ],
  cooking: [
    "Bí quyết để món bò kho mềm tan chính là phải ướp với một chút nước dừa tươi. #cooking #monngon",
    "Công thức làm bánh mì sourdough tại nhà thành công ngay từ lần đầu. #sourdough",
    "Cách nấu phở bò chuẩn vị Hà Nội với nước dùng trong và thơm mùi quế hồi. #phobo",
    "Mẹo giữ rau củ luôn xanh giòn khi xào ở nhiệt độ cao.",
    "Hướng dẫn làm cà phê muối thơm ngậy, món hot trend cực dễ làm. #caphemuoi",
    "Sự khác biệt giữa các loại nước mắm và cách chọn loại ngon cho từng món ăn. #foodtips",
    "Cách làm salad ức gà cho người đang theo chế độ ăn kiêng Eat Clean. #eatclean",
    "Bí kíp chiên khoai tây giòn lâu mà không bị thấm dầu mỡ.",
    "Nấu canh chua cá lóc miền Tây đúng điệu phải có bông điên điển. #canhchua",
    "Hướng dẫn làm sữa chua dẻo tại nhà không cần máy ủ.",
    "Cách tẩm ướp thịt nướng cực ngon như ngoài hàng. #bbq",
    "Làm sao để nấu cơm tấm dẻo thơm và nước mắm kẹo đậm đà?",
    "Chia sẻ cách làm bánh trung thu nhân thập cẩm truyền thống. #mooncake",
    "Mẹo sơ chế lòng lợn sạch và không còn mùi hôi cực hiệu quả.",
    "Cách làm kim chi Hàn Quốc giòn cay, chuẩn vị để được lâu. #kimchi",
    "Nấu chè bưởi không bị đắng với bí quyết xử lý cùi bưởi. #chebuoi",
    "Học cách trang trí món ăn đẹp mắt để tăng thêm phần hấp dẫn.",
    "Tầm quan trọng của việc sử dụng các loại gia vị tự nhiên trong nấu ăn.",
    "Review bộ nồi inox cao cấp, truyền nhiệt đều và rất bền bỉ.",
    "Cách làm sốt vang thơm lừng cho những ngày thời tiết se lạnh. #beefstew",
    "Hướng dẫn làm trà sữa trân châu đường đen tại nhà. #milktea",
    "Mẹo rã đông thực phẩm nhanh mà vẫn giữ được độ tươi ngon.",
    "Cách nấu lẩu nấm thanh đạm cho bữa cơm gia đình cuối tuần. #mushroompot",
    "Làm bánh flan mịn màng, không bị rỗ với mẹo nhỏ này.",
    "Công thức làm thịt kho tàu trứng cút đậm đà đưa cơm. #thitkhotau",
    "Hướng dẫn làm các loại mứt tết thơm ngon, an toàn vệ sinh.",
    "Cách chọn thực phẩm sạch và an toàn đi chợ mỗi ngày. #healthyfood",
    "Nấu món ăn chay ngon và đủ chất dinh dưỡng cho cả nhà.",
    "Review các loại lò vi sóng đa năng, hỗ trợ đắc lực cho việc nấu nướng.",
    "Cách làm nước chấm hải sản thần thánh cân mọi món đồ biển. #seafood"
  ],
  movie: [
    "Vừa xem xong siêu phẩm của Nolan, thực sự cân não và quá ấn tượng về âm thanh. #Nolan #Oppenheimer",
    "Dàn diễn viên trong bộ phim mới này diễn xuất quá đỉnh, xứng đáng giải Oscar. #Oscars",
    "Những bộ phim hoạt hình của Ghibli luôn mang lại cảm giác bình yên đến lạ. #Ghibli #Anime",
    "Review phim chiếu rạp cuối tuần: Nội dung hơi yếu nhưng kỹ xảo rất mãn nhãn. #MovieReview",
    "Những bộ phim truyền hình Hàn Quốc đang làm mưa làm gió trên Netflix. #KDrama",
    "Tầm quan trọng của kịch bản đối với sự thành công của một bộ phim.",
    "Phân tích ý nghĩa ẩn dụ trong các tác phẩm điện ảnh kinh điển. #Cinema",
    "Những bộ phim về đề tài thảm họa khiến người xem phải suy ngẫm.",
    "Review phim kinh dị mới nhất: Không quá đáng sợ nhưng bầu không khí rất ám ảnh. #Horror",
    "Sự trở lại của các siêu anh hùng Marvel trong giai đoạn mới có gì đáng mong đợi? #Marvel",
    "Những bộ phim hài hước giúp giải tỏa căng thẳng sau giờ làm việc.",
    "Cách các nhà làm phim tạo ra những cảnh quay hành động gay cấn.",
    "Nhạc phim (OST) hay cũng là một yếu tố giúp bộ phim đi vào lòng người. #OST",
    "Phim tài liệu về thiên nhiên luôn mang lại những góc nhìn mới lạ.",
    "Tại sao các bộ phim độc lập (Indie) ngày càng được khán giả yêu thích? #IndieFilm",
    "Review phim trinh thám với những cú twist không thể lường trước. #Thriller",
    "Những đạo diễn có phong cách làm phim độc đáo nhất hiện nay.",
    "Lịch sử phát triển của điện ảnh thế giới qua các thời kỳ.",
    "Những bộ phim chuyển thể từ tiểu thuyết thành công nhất.",
    "Review phim thanh xuân vườn trường mang lại nhiều kỷ niệm tuổi trẻ. #Youth",
    "Tại sao các bộ phim ngắn đang trở thành xu hướng trên mạng xã hội?",
    "Cách sử dụng màu sắc trong phim để truyền tải cảm xúc người xem.",
    "Những bộ phim lấy nước mắt khán giả nhiều nhất mọi thời đại.",
    "Review series phim hình sự kịch tính đến từng giây. #Criminal",
    "Tầm quan trọng của thiết kế phục trang trong phim cổ trang.",
    "Những bộ phim lấy đề tài khoa học viễn tưởng đáng xem nhất. #SciFi",
    "Sự khác biệt giữa phim chiếu rạp và phim trực tuyến trên các nền tảng.",
    "Review phim hành động võ thuật đỉnh cao với những pha đánh đấm thực thụ.",
    "Những bộ phim truyền cảm hứng mạnh mẽ về nghị lực sống.",
    "Phân tích vai trò của biên tập phim trong việc tạo nhịp điệu cho tác phẩm."
  ],
  travel: [
    "Đà Lạt mùa này không khí thật trong lành, sáng sớm se lạnh cực thích. #Dalat #Travel",
    "Kinh nghiệm đi du lịch tự túc ở Thái Lan với chi phí cực kỳ tiết kiệm. #Thailand",
    "Khám phá những hòn đảo hoang sơ ở Phú Quốc chưa nhiều người biết đến. #PhuQuoc",
    "Review chi tiết khách sạn 5 sao ở Nha Trang với view biển cực đẹp. #Beachlife",
    "Những vật dụng không thể thiếu trong hành lý khi đi du lịch nước ngoài.",
    "Hành trình leo núi Fansipan chinh phục nóc nhà Đông Dương. #Fansipan",
    "Vẻ đẹp của ruộng bậc thang Mù Cang Chải vào mùa lúa chín vàng. #MuCangChai",
    "Cách săn vé máy bay giá rẻ cho chuyến du lịch hè sắp tới. #Flightdeals",
    "Thưởng thức ẩm thực đường phố tại Hội An - phố cổ lung linh về đêm. #HoiAn",
    "Kinh nghiệm thuê xe máy khám phá các cung đường phượt miền Bắc. #Phuot",
    "Review tour du lịch Singapore 4 ngày 3 đêm, lịch trình rất dày và vui. #Singapore",
    "Những bãi biển đẹp nhất miền Trung bạn nên ghé thăm một lần.",
    "Cách bảo quản thiết bị công nghệ khi đi du lịch biển hoặc leo núi.",
    "Tại sao du lịch bền vững và bảo vệ môi trường đang là xu hướng? #Ecotourism",
    "Khám phá vẻ đẹp cổ kính của thủ đô Kyoto, Nhật Bản. #Kyoto",
    "Review các ứng dụng đặt phòng và phương tiện đi lại hữu ích nhất.",
    "Những điều cần lưu ý về văn hóa khi đi du lịch các nước Hồi giáo.",
    "Hành trình xuyên Việt bằng xe máy - giấc mơ của mọi phượt thủ.",
    "Vẻ đẹp hùng vĩ của vịnh Hạ Long nhìn từ thủy phi cơ. #HaLong",
    "Kinh nghiệm đi du lịch Hà Giang với những khúc cua tay áo nghẹt thở. #HaGiang",
    "Những địa điểm check-in cực hot ở Quy Nhơn hiện nay. #QuyNhon",
    "Cách xử lý khi bị mất hộ chiếu hoặc tài sản khi đang ở nước ngoài.",
    "Du lịch tâm linh: Khám phá các ngôi chùa cổ tự linh thiêng tại Việt Nam.",
    "Review chuyến đi camping cuối tuần cùng gia đình gần ngoại thành. #Camping",
    "Vẻ đẹp quyến rũ của các thành phố châu Âu vào mùa Giáng sinh.",
    "Cách lên kế hoạch du lịch chi tiết và quản lý ngân sách hiệu quả.",
    "Những hòn đảo đẹp như thiên đường ở Philippines bạn không nên bỏ lỡ.",
    "Du lịch một mình (Solo Travel): Những trải nghiệm tự do tự tại.",
    "Review các trang trại homestay gần gũi với thiên nhiên tại Mộc Châu.",
    "Tầm quan trọng của bảo hiểm du lịch trong các chuyến đi dài ngày."
  ],
  music: [
    "Giai điệu của bài hát này thực sự rất chill, nghe vào buổi sáng rất hợp. #music #chill",
    "Sự kết hợp giữa nhạc cụ truyền thống và hiện đại mang lại cảm giác mới lạ.",
    "Review buổi concert tối qua, âm thanh và ánh sáng thực sự bùng nổ. #Concert",
    "Những ca sĩ có giọng hát thực lực đang dần chiếm lại ưu thế trên bảng xếp hạng.",
    "Dòng nhạc Indie đang ngày càng khẳng định vị thế trong lòng giới trẻ. #Indie",
    "Cách tạo ra một bản phối nhạc (remix) bắt tai cho các DJ mới vào nghề.",
    "Tầm quan trọng của lời bài hát trong việc kết nối cảm xúc người nghe.",
    "Phân tích sự phát triển của dòng nhạc Pop qua các thập kỷ. #PopMusic",
    "Những bộ phim về cuộc đời của các nghệ sĩ âm nhạc vĩ đại.",
    "Review các dòng tai nghe chuyên dụng cho audiophile, âm thanh cực chi tiết. #Audiophile",
    "Tại sao đĩa than (Vinyl) đang quay trở lại mạnh mẽ trong giới sưu tầm? #Vinyl",
    "Những bài hát giúp tập trung hơn khi làm việc hoặc học tập.",
    "Khám phá thế giới nhạc Jazz với những bản nhạc đầy ngẫu hứng. #Jazz",
    "Cách các nghệ sĩ xây dựng hình ảnh và thương hiệu cá nhân trong âm nhạc.",
    "Sự ảnh hưởng của âm nhạc K-Pop đối với văn hóa toàn cầu. #KPop",
    "Review các phần mềm làm nhạc chuyên nghiệp (DAW) tốt nhất hiện nay.",
    "Những lễ hội âm nhạc lớn nhất thế giới bạn nên tham gia một lần.",
    "Âm nhạc trị liệu: Cách âm thanh giúp chữa lành tâm hồn và giảm stress. #Healing",
    "Phân tích cấu trúc của một bản nhạc giao hưởng kinh điển.",
    "Tại sao các bài hát xưa (Retro) vẫn luôn có sức sống mãnh liệt?",
    "Review micro thu âm chuyên nghiệp cho các bạn làm podcast hoặc cover.",
    "Hành trình từ một nhạc công đường phố đến ngôi sao âm nhạc quốc tế.",
    "Cách luyện giọng và cải thiện kỹ năng ca hát tại nhà. #Singing",
    "Những ca khúc mang thông điệp ý nghĩa về tình yêu và cuộc sống.",
    "Review các dòng loa bluetooth chất lượng cao cho nhu cầu di động.",
    "Sự khác biệt giữa nhạc số (Digital) và nhạc analog về chất lượng âm thanh.",
    "Những nhạc sĩ có khả năng sáng tác và tự trình bày xuất sắc nhất.",
    "Khám phá các dòng nhạc Rock với sức mạnh năng lượng tràn đầy. #Rock",
    "Tầm quan trọng của vũ đạo trong các buổi biểu diễn âm nhạc hiện đại.",
    "Review các trang web học chơi nhạc cụ trực tuyến hiệu quả nhất."
  ],
  finance: [
    "Thị trường chứng khoán hôm nay có biến động mạnh, cần cẩn trọng khi giải ngân. #stocks #finance",
    "Cách quản lý tài chính cá nhân theo quy tắc 50/30/20 cực kỳ hiệu quả. #moneytips",
    "Đầu tư vào bản thân là khoản đầu tư có lợi nhuận cao nhất mọi thời đại.",
    "Tìm hiểu về các quỹ chỉ số (ETF) cho người mới bắt đầu tìm hiểu đầu tư. #ETF",
    "Sự khác biệt giữa tiết kiệm và đầu tư: Làm sao để tiền sinh lời bền vững?",
    "Những sai lầm phổ biến khi sử dụng thẻ tín dụng khiến bạn dễ mắc nợ. #CreditCard",
    "Cách xây dựng quỹ dự phòng khẩn cấp để đối phó với những rủi ro bất ngờ.",
    "Tầm quan trọng của việc lập kế hoạch tài chính cho việc nghỉ hưu sớm. #Retirement",
    "Phân tích xu hướng giá vàng thế giới và những tác động đến thị trường trong nước. #Gold",
    "Bất động sản vẫn là kênh đầu tư an toàn và tiềm năng trong dài hạn. #RealEstate",
    "Làm sao để thoát khỏi bẫy tiêu xài hoang phí và nợ nần?",
    "Tìm hiểu về bảo hiểm nhân thọ: Có thực sự cần thiết cho giới trẻ không?",
    "Cách dạy con trẻ về giá trị của đồng tiền và thói quen tiết kiệm.",
    "Sức mạnh của lãi suất kép trong việc tích lũy tài sản dài hạn. #CompoundInterest",
    "Review các ứng dụng quản lý chi tiêu đơn giản và hiệu quả nhất.",
    "Đầu tư vào các startup công nghệ: Cơ hội đi kèm với rủi ro lớn. #Startup",
    "Cách đọc và hiểu các chỉ số cơ bản trên báo cáo tài chính doanh nghiệp.",
    "Tầm quan trọng của việc đa dạng hóa danh mục đầu tư để giảm thiểu rủi ro.",
    "Lạm phát là gì và nó ảnh hưởng đến túi tiền của bạn như thế nào? #Inflation",
    "Kinh nghiệm vay vốn ngân hàng để mua nhà hoặc kinh doanh an toàn.",
    "Tại sao cần phải có kỷ luật thép trong việc thực hiện mục tiêu tài chính?",
    "Phân tích thị trường ngoại hối (Forex) dành cho những người ưa mạo hiểm. #Forex",
    "Cách tìm kiếm các nguồn thu nhập thụ động bền vững theo thời gian.",
    "Review các khóa học về đầu tư tài chính chất lượng hiện nay.",
    "Tầm quan trọng của việc cập nhật kiến thức kinh tế vĩ mô hàng ngày.",
    "Sự khác biệt giữa đầu tư giá trị và đầu tư lướt sóng ngắn hạn.",
    "Làm sao để xây dựng điểm tín dụng tốt cho các nhu cầu vay vốn sau này?",
    "Review các dòng thẻ ngân hàng có nhiều ưu đãi hoàn tiền và dặm bay.",
    "Tương lai của tài chính phi tập trung (DeFi) và những thách thức mới.",
    "Cách đàm phán lương và quyền lợi khi thay đổi công việc mới."
  ],
  health: [
    "Uống đủ nước mỗi ngày giúp làn da luôn căng mọng và cơ thể tràn đầy năng lượng. #health #skincare",
    "Tầm quan trọng của giấc ngủ đủ 7-8 tiếng đối với sức khỏe tinh thần.",
    "Những bài tập Yoga đơn giản giúp giảm đau lưng cho người làm văn phòng. #Yoga",
    "Chế độ ăn nhiều rau xanh và trái cây là chìa khóa của sự trẻ lâu.",
    "Cách phòng tránh các bệnh truyền nhiễm khi thời tiết thay đổi thất thường.",
    "Tác hại của việc ngồi quá lâu và cách khắc phục bằng các bài tập vận động nhẹ. #FitTips",
    "Tại sao thiền định (Meditation) giúp giảm stress và tăng cường sự tập trung? #Meditation",
    "Review các loại thực phẩm chức năng bổ sung vitamin và khoáng chất cần thiết. #Vitamins",
    "Cách xây dựng thói quen tập thể dục đều đặn 30 phút mỗi ngày. #Fitness",
    "Tầm quan trọng của việc khám sức khỏe định kỳ để phát hiện sớm bệnh tật.",
    "Làm sao để duy trì vóc dáng thon gọn mà không cần ăn kiêng quá hà khắc?",
    "Cách bảo vệ đôi mắt khi phải làm việc liên tục với máy tính và điện thoại. #Eyehealth",
    "Sự khác biệt giữa các loại sữa hạt và lợi ích của chúng đối với sức khỏe.",
    "Mẹo chữa mất ngủ tự nhiên không cần dùng thuốc cực kỳ hiệu quả.",
    "Tầm quan trọng của việc giữ tinh thần lạc quan trong việc điều trị bệnh.",
    "Review các dòng đồng hồ thông minh hỗ trợ theo dõi sức khỏe và nhịp tim. #Smartwatch",
    "Cách chăm sóc da mặt đúng cách để ngăn ngừa mụn và lão hóa.",
    "Những siêu thực phẩm (Superfoods) bạn nên bổ sung vào thực đơn hàng ngày. #Superfood",
    "Lợi ích của việc đi bộ 10,000 bước mỗi ngày đối với tim mạch. #Walking",
    "Cách xử lý sơ cứu cơ bản khi gặp các tai nạn thường gặp trong gia đình.",
    "Tác hại của thuốc lá và rượu bia đối với sức khỏe về lâu dài.",
    "Chế độ ăn Keto: Những điều cần lưu ý để thực hiện một cách an toàn. #Keto",
    "Review các phòng tập Gym chất lượng với trang thiết bị hiện đại.",
    "Cách cải thiện hệ tiêu hóa bằng việc bổ sung men vi sinh và chất xơ. #DigestiveHealth",
    "Tầm quan trọng của sức khỏe tinh thần và cách tìm kiếm sự hỗ trợ tâm lý. #MentalHealth",
    "Những thói quen tốt vào buổi sáng giúp khởi đầu ngày mới tỉnh táo.",
    "Cách giảm cân an toàn và khoa học không gây mệt mỏi cho cơ thể.",
    "Review các loại thảm tập Yoga êm ái và có độ bám tốt.",
    "Tại sao việc hít thở đúng cách lại cực kỳ quan trọng đối với sức khỏe?",
    "Cách duy trì lối sống lành mạnh cho cả gia đình trong kỷ nguyên hiện đại."
  ],
  astronomy: [
    "Kính thiên văn Hubble vừa gửi về những hình ảnh tuyệt đẹp về các thiên hà xa xôi. #Astronomy #Hubble",
    "Hiện tượng nguyệt thực toàn phần tối nay sẽ là một cảnh tượng không thể bỏ lỡ. #Eclipse",
    "Sự hình thành của các lỗ đen vẫn còn là một ẩn số lớn đối với khoa học hiện đại. #BlackHole",
    "Tìm hiểu về các hành tinh trong hệ mặt trời và khả năng tồn tại sự sống. #SolarSystem",
    "Dự án định cư trên sao Hỏa của SpaceX đang tiến triển như thế nào? #Mars #SpaceX",
    "Vẻ đẹp của dải Ngân hà nhìn từ những khu vực không bị ô nhiễm ánh sáng. #MilkyWay",
    "Cách các ngôi sao được sinh ra và kết thúc vòng đời bằng các vụ nổ siêu tân tinh. #Supernova",
    "Tầm quan trọng của việc khám phá vũ trụ đối với tương lai của nhân loại. #SpaceDiscovery",
    "Phân tích thuyết tương đối của Einstein và những ứng dụng trong thiên văn học. #Einstein",
    "Những vệ tinh nhân tạo đang giúp chúng ta quan sát trái đất và vũ trụ. #Satellite",
    "Review các mẫu kính thiên văn dành cho người mới bắt đầu đam mê quan sát. #Telescope",
    "Hiện tượng mưa sao băng Perseids sẽ đạt cực điểm vào rạng sáng mai. #MeteorShower",
    "Sự giãn nở của vũ trụ và những giả thuyết về sự kết thúc của không thời gian.",
    "Cách các nhà thiên văn đo đạc khoảng cách giữa các thiên hà hàng tỷ năm ánh sáng. #Galaxy",
    "Vẻ đẹp huyền bí của các tinh vân (Nebula) rực rỡ sắc màu trong không gian. #Nebula",
    "Tìm hiểu về vật chất tối và năng lượng tối chiếm phần lớn vũ trụ.",
    "Những chuyến hành trình không người lái thám hiểm các hành tinh xa xôi. #NASA",
    "Tại sao mặt trăng lại có ảnh hưởng lớn đến các hiện tượng trên trái đất?",
    "Review các ứng dụng quan sát bầu trời đêm trên điện thoại cực kỳ tiện lợi.",
    "Hành trình khám phá các ngoại hành tinh (Exoplanets) nằm ngoài hệ mặt trời.",
    "Sự kỳ diệu của các pulsar - những ngôi sao neutron quay cực nhanh.",
    "Cách chụp ảnh thiên văn (Astrophotography) cực đẹp bằng máy ảnh DSLR.",
    "Những khám phá mới nhất về nguồn gốc của hệ mặt trời chúng ta.",
    "Tầm quan trọng của việc bảo vệ bầu trời đêm khỏi ô nhiễm ánh sáng đô thị.",
    "Vũ trụ song song: Liệu có tồn tại những thế giới khác ngoài vũ trụ này?"
  ],
  comments: [
    "Bài viết thực sự rất hữu ích, cảm ơn bạn đã chia sẻ!",
    "Tôi hoàn toàn đồng ý với quan điểm này của tác giả.",
    "Góc nhìn mới lạ thật, trước giờ tôi chưa từng nghĩ theo hướng này.",
    "Có vẻ như số liệu trong bài cần được kiểm chứng lại một chút.",
    "Mong bạn ra thêm nhiều bài viết chất lượng như thế này nhé.",
    "Đúng nội dung mình đang tìm kiếm bấy lâu nay, tuyệt vời!",
    "Cho mình hỏi thêm một chút về phần kỹ thuật bạn đề cập ở trên được không?",
    "Bài viết phân tích rất sâu sắc và có tâm.",
    "Đọc bài xong thấy mở mang ra được nhiều kiến thức mới quá.",
    "Mình không đồng tình lắm, theo mình thì nên nhìn nhận ở một khía cạnh khác.",
    "Ảnh minh họa đẹp quá, bạn chụp bằng máy gì vậy?",
    "Một chủ đề rất hay và đáng để mọi người cùng thảo luận.",
    "Bạn có thể viết thêm về phần nâng cao của chủ đề này không?",
    "Rất thực tế, áp dụng được ngay vào công việc hàng ngày.",
    "Không uổng công dành thời gian đọc hết bài viết này, quá hay!",
    "Mình cũng đã từng trải qua trường hợp tương tự, rất đồng cảm với tác giả.",
    "Nội dung trình bày rất khoa học và dễ hiểu.",
    "Một đóng góp tuyệt vời cho cộng đồng Twizzy!",
    "Hi vọng bài viết này sẽ được nhiều người biết đến hơn.",
    "Lần đầu nghe về khái niệm này, thú vị thật đấy.",
    "Cảm ơn những thông tin bổ ích từ bạn.",
    "Phần kết luận của bài viết rất súc tích và đắt giá.",
    "Chào tác giả, bài viết rất xuất sắc!",
    "Có chỗ này mình chưa hiểu rõ lắm, bạn giải thích thêm được không?",
    "Văn phong của bạn rất cuốn hút, mình đọc một lèo là xong.",
    "Bài viết này giúp ích cho mình rất nhiều trong dự án sắp tới.",
    "Tương tác mạnh để bài viết này lên xu hướng nào anh em ơi!",
    "Chuẩn luôn, không cần chỉnh.",
    "Tiếp tục phát huy nhé tác giả.",
    "Yêu bài viết này quá đi mất.",
    "Cảm ơn tác giả nhiều nhé.",
    "Bài này đỉnh thật sự.",
    "Rất đáng để suy ngẫm.",
    "Tuyệt vời ông mặt trời!",
    "Sẽ ủng hộ bạn dài dài."
  ],
  quotes: [
    "Một góc nhìn bổ sung rất hay cho bài viết gốc.",
    "Mọi người nên đọc bài viết gốc này, cực kỳ giá trị luôn!",
    "Mình xin phép quote lại để mọi người cùng thảo luận nhé.",
    "Thêm một minh chứng nữa cho quan điểm mà mình đã từng chia sẻ.",
    "Bài viết này làm mình nhớ đến một trải nghiệm tương tự.",
    "Rất đồng tình với tác giả, đặc biệt là phần kết luận.",
    "Nội dung quá xuất sắc, không thể không chia sẻ lại.",
    "Một ví dụ điển hình cho thấy tầm quan trọng của chủ đề này."
  ]
}

/**
 * QUẢN LÝ KHO NỘI DUNG (MEMORIZED POOL)
 */
class ContentPool {
  private pool: Record<string, string[]>

  constructor() {
    this.pool = JSON.parse(JSON.stringify(CONTENT_LIBRARY))
  }

  getNext(topic: Topic | 'comments' | 'quotes'): string {
    const list = this.pool[topic]
    if (!list || list.length === 0) return `Nội dung mặc định cho ${topic}`
    const index = Math.floor(Math.random() * list.length)
    const content = list[index]
    list.splice(index, 1)
    return content
  }
}

const contentPool = new ContentPool()

/**
 * TỰ ĐỘNG BÓC TÁCH VÀ LƯU HASHTAG TỪ NỘI DUNG
 */
async function extractAndUpsertHashtags(content: string): Promise<ObjectId[]> {
  const hashtags = content.match(/#[\w\u00C0-\u1EF9]+/g) || []
  const hashtagIds: ObjectId[] = []

  for (let tag of hashtags) {
    const name = tag.slice(1).toLowerCase() // Bỏ dấu #
    const existing = await databaseService.hashtags.findOneAndUpdate(
      { name },
      { $setOnInsert: new Hashtag({ name }) },
      { upsert: true, returnDocument: 'after' }
    )
    if (existing?._id) hashtagIds.push(existing._id)
  }
  return hashtagIds
}

async function cleanupOldSeedData() {
  const users = await databaseService.users
    .find({ email: { $regex: `^${SEED_TAG}\\+` } }, { projection: { _id: 1 } })
    .toArray()
  const userIds = users.map((u) => u._id as ObjectId)
  if (userIds.length === 0) return
  await databaseService.likes.deleteMany({ user_id: { $in: userIds } })
  await databaseService.followers.deleteMany({ $or: [{ user_id: { $in: userIds } }, { followed_user_id: { $in: userIds } }] })
  await databaseService.twizzs.deleteMany({ user_id: { $in: userIds } })
  await databaseService.users.deleteMany({ _id: { $in: userIds } })
}

async function createUser(key: string) {
  const userId = new ObjectId()
  const now = new Date()

  // Dùng Object thuần để tránh các thuộc tính ẩn từ Class gây lỗi Validation
  const user = {
    _id: userId,
    name: faker.internet.displayName(),
    email: `${SEED_TAG}+${key}@example.com`,
    username: `${SEED_TAG}_${key}`,
    password: await hashPassword(PASSWORD),
    date_of_birth: faker.date.birthdate({ min: 18, max: 35, mode: 'age' }),
    verify: UserVerifyStatus.Verified,
    created_at: now,
    updated_at: now,
    avatar: '',
    bio: 'Tôi là một user test của Twizzy',
    cover_photo: '',
    email_verify_otp: '',
    email_verify_token: '',
    forgot_password_otp: '',
    forgot_password_token: '',
    location: 'Vietnam',
    website: 'https://twizzy.com',
    twizz_circle: [],
    violation_count: 0,
    role: 0,
    fcm_tokens: [],
    username_changed: false,
    email_verify_otp_expires_at: null,
    forgot_password_otp_expires_at: null,
    interest_vector: new Array(768).fill(new Double(0)) // Ép kiểu Double để thỏa mãn MongoDB Validation
  }

  await databaseService.users.insertOne(user as any)
  return userId
}

async function createTwizz(authorId: ObjectId, topic: Topic, createdAt?: Date) {
  const content = contentPool.getNext(topic)
  const now = createdAt ?? new Date()

  // Tự động bóc tách hashtag từ chuỗi
  const hashtags = await extractAndUpsertHashtags(content)
  const content_vector = await embeddingService.generateEmbedding(content)

  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.Twizz,
    audience: TwizzAudience.Everyone,
    content,
    parent_id: null,
    hashtags: hashtags,
    mentions: [],
    medias: [],
    guest_views: 0,
    user_views: 0,
    created_at: now,
    updated_at: now,
    content_vector
  })
  return twizz
}

async function createComment(authorId: ObjectId, parentTwizzId: ObjectId) {
  const content = contentPool.getNext('comments')
  const hashtags = await extractAndUpsertHashtags(content)
  const content_vector = await embeddingService.generateEmbedding(content)
  const now = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)

  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.Comment,
    audience: TwizzAudience.Everyone,
    content,
    parent_id: parentTwizzId.toString(),
    hashtags,
    mentions: [],
    medias: [],
    created_at: now,
    updated_at: now,
    content_vector
  })
  await databaseService.twizzs.insertOne(twizz)
  return twizz._id as ObjectId
}

async function createQuote(authorId: ObjectId, parentTwizzId: ObjectId) {
  const content = contentPool.getNext('quotes')
  const hashtags = await extractAndUpsertHashtags(content)
  const content_vector = await embeddingService.generateEmbedding(content)
  const now = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)

  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.QuoteTwizz,
    audience: TwizzAudience.Everyone,
    content,
    parent_id: parentTwizzId.toString(),
    hashtags,
    mentions: [],
    medias: [],
    created_at: now,
    updated_at: now,
    content_vector
  })
  await databaseService.twizzs.insertOne(twizz)
  return twizz._id as ObjectId
}

async function main() {
  await databaseService.connect()
  console.log(`[seed] Cleaning old data...`)
  await cleanupOldSeedData()

  console.log('[seed] Creating users...')
  const userColdNoFollow = await createUser('cold_no_follow')
  const userColdFollow = await createUser('cold_follow')
  const userContentOnly = await createUser('content_only')
  const userContentActive = await createUser('content_active')
  const userContentNiche = await createUser('content_niche')
  const bgUsers: ObjectId[] = []
  for (let i = 1; i <= 20; i++) bgUsers.push(await createUser(`bg_${i}`))

  console.log('[seed] Generating 220 posts with hashtags & vectors...')
  const twizzDocs: Twizz[] = []
  const twizzPool: Array<{ _id: ObjectId, topic: Topic }> = []

  // LƯU Ý: i % 8 (không phải % 9) → chủ đề 'astronomy' (index 8) KHÔNG nằm trong pool chính.
  // Astronomy được tạo riêng ở phần Hybrid Fallback bên dưới (niche topic).
  for (let i = 0; i < 220; i++) {
    const topic = TOPICS[i % 8]
    const authorId = bgUsers[i % bgUsers.length]
    const twizz = await createTwizz(authorId, topic)
    twizzDocs.push(twizz)
    twizzPool.push({ _id: twizz._id as ObjectId, topic })
  }
  await databaseService.twizzs.insertMany(twizzDocs)

  console.log('[seed] Setup test interactions...')
  // Cold Follow: follow 3 bg users
  await Promise.all(bgUsers.slice(0, 3).map(id => databaseService.followers.insertOne(new Follower({ user_id: userColdFollow, followed_user_id: id, created_at: new Date() }))))

  // 1. Kho bài viết cho các chủ đề test
  const techPosts = twizzPool.filter(p => p.topic === 'tech')
  const cookPosts = twizzPool.filter(p => p.topic === 'cooking')
  const financePosts = twizzPool.filter(p => p.topic === 'finance')
  const healthPosts = twizzPool.filter(p => p.topic === 'health')

  // 2. User Content Active: Thích cả Tech và Cooking (Đa sở thích, nhiều tương tác)
  for (const p of techPosts.slice(0, 12)) {
    await databaseService.likes.insertOne(new Like({ user_id: userContentActive, twizz_id: p._id, created_at: new Date() }))
  }
  for (const p of cookPosts.slice(0, 10)) {
    await databaseService.likes.insertOne(new Like({ user_id: userContentActive, twizz_id: p._id, created_at: new Date() }))
    if (Math.random() > 0.5) await createComment(userContentActive, p._id)
  }

  // 3. Nhóm BG thích Tech → tạo trending cho bài Tech + Finance
  const groupTech = bgUsers.slice(0, 5)
  for (const bgId of groupTech) {
    for (const p of faker.helpers.arrayElements(techPosts.slice(0, 12), 8)) {
      await databaseService.likes.insertOne(new Like({ user_id: bgId, twizz_id: p._id, created_at: new Date() }))
    }
    for (const p of financePosts.slice(0, 8)) {
      await databaseService.likes.insertOne(new Like({ user_id: bgId, twizz_id: p._id, created_at: new Date() }))
    }
  }

  // 4. Nhóm BG thích Cooking → tạo trending cho bài Cooking + Health
  const groupCook = bgUsers.slice(5, 10)
  for (const bgId of groupCook) {
    for (const p of faker.helpers.arrayElements(cookPosts.slice(0, 10), 7)) {
      await databaseService.likes.insertOne(new Like({ user_id: bgId, twizz_id: p._id, created_at: new Date() }))
    }
    for (const p of healthPosts.slice(0, 8)) {
      await databaseService.likes.insertOne(new Like({ user_id: bgId, twizz_id: p._id, created_at: new Date() }))
    }
  }

  // 5. Các tương tác khác để tạo Trending đa dạng
  const remainingPosts = twizzPool.slice(15, 40)
  for (const bg of bgUsers.slice(10, 20)) {
    for (const post of faker.helpers.arrayElements(remainingPosts, 3)) {
      await databaseService.likes.insertOne(new Like({ user_id: bg, twizz_id: post._id, created_at: new Date() }))
    }
  }

  // Content Only (Football) — ít tương tác, chỉ 5 like
  const fbPosts = twizzPool.filter(p => p.topic === 'football').slice(0, 5)
  for (const p of fbPosts) await databaseService.likes.insertOne(new Like({ user_id: userContentOnly, twizz_id: p._id, created_at: new Date() }))

  // Content Niche (Astronomy) — user thích chủ đề hiếm
  console.log('[seed] Creating niche pool (Astronomy)...')
  const nicheAuthor = bgUsers[bgUsers.length - 1]
  const nicheDocs: Twizz[] = []
  for (let i = 0; i < 25; i++) {
    const t = await createTwizz(nicheAuthor, 'astronomy')
    nicheDocs.push(t)
    if (i < 15) {
      if (i < 10) await databaseService.likes.insertOne(new Like({ user_id: userContentNiche, twizz_id: t._id as ObjectId, created_at: new Date() }))
      else await createComment(userContentNiche, t._id as ObjectId)
    }
  }
  await databaseService.twizzs.insertMany(nicheDocs)

  console.log('\n========== SEED DONE (SEMANTIC + AUTO-HASHTAG) ==========')
  console.log('Password:', PASSWORD)
}

main().catch(console.error)
