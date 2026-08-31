/**
 * Full writing methodology for style_guide.md injection.
 * This is the complete reference material (with examples) that the
 * compact "craft card" in the system prompt summarizes.
 *
 * Injected once during initBook/generateStyleGuide, then read by
 * writer on every chapter as part of the style_guide context.
 */
export function buildWritingMethodologySection(language: "vi" | "en"): string {
  return language === "en" ? buildEnglishMethodology() : buildVietnameseMethodology();
}

function buildVietnameseMethodology(): string {
  return `---

# Tham khảo phương pháp viết (Bản đầy đủ)

Đây là tài liệu tham khảo đầy đủ về chất lượng sáng tác. Hãy vận dụng các nguyên tắc này một cách tự nhiên.

## 1. Loại bỏ dấu vết văn phong máy móc

### Miêu tả cảm xúc
| Chưa tốt (máy móc) | Tốt (tự nhiên) | Trọng tâm |
|---|---|---|
| Anh ấy cảm thấy vô cùng tức giận. | Anh bóp vỡ chén trà trong tay. Nước nóng chảy qua kẽ ngón mà anh không hề giật mình. | Thể hiện cảm xúc qua hành động |
| Cô ấy rất buồn và nước mắt tuôn rơi. | Cô siết điện thoại đến trắng bệch các khớp ngón. Dòng tin nhắn nhòe đi trước mắt. | Dùng chi tiết cơ thể thay cho nhãn cảm xúc |
| Anh cảm thấy sợ hãi. | Lông sau gáy anh dựng đứng; lòng bàn chân lạnh như đang giẫm lên băng. | Truyền nỗi sợ qua giác quan |

### Chuyển ý và liên kết
| Chưa tốt | Tốt | Trọng tâm |
|---|---|---|
| Mặc dù anh rất mạnh, nhưng anh vẫn thua. | Anh mạnh thật. Nhưng lão già bên kia chơi bẩn hơn. | Chuyển ý bằng giọng kể tự nhiên |
| Tuy nhiên, mọi chuyện không đơn giản như vậy. | Đâu có chuyện dễ dàng thế. | Dùng suy nghĩ nhân vật thay cho từ nối khuôn mẫu |
| Vì vậy, anh quyết định hành động. | Anh đứng bật dậy, đá chiếc ghế sang một bên. | Bỏ từ nối nhân quả, đi thẳng vào hành động |

## 2. Sáu bước phân tích tâm lý nhân vật

Mỗi hành động quan trọng của nhân vật phải được suy ra qua sáu bước:
1. **Hoàn cảnh hiện tại**: Nhân vật đang đối mặt với điều gì? Họ có những nguồn lực nào?
2. **Động cơ cốt lõi**: Họ muốn gì nhất? Sợ gì nhất?
3. **Giới hạn thông tin**: Họ biết gì, không biết gì, và đang hiểu sai điều gì?
4. **Bộ lọc tính cách**: Với cùng hoàn cảnh, riêng nhân vật này sẽ phản ứng ra sao?
5. **Lựa chọn hành vi**: Từ bốn bước trên, họ sẽ chọn làm gì?
6. **Biểu hiện cảm xúc**: Cảm xúc đi kèm được thể hiện qua cơ thể, nét mặt và giọng nói thế nào?

Không được bỏ qua quá trình suy luận để ép nhân vật hành động theo cốt truyện.

## 3. Thiết kế nhân vật phụ

- Nhân vật phụ phải có mục tiêu, toan tính và khả năng phản công riêng. Nhân vật chính thuyết phục hoặc vượt qua người thông minh, không nghiền nát những kẻ ngốc.
- Động cơ của mỗi nhân vật phụ phải liên hệ với tuyến truyện chính.
- Đặc điểm cốt lõi + chi tiết tương phản = con người sống động (người ngoài lạnh lùng nhưng lén cho mèo hoang ăn).
- Xây dựng tính cách qua sự kiện, không chồng chất ngoại hình và tính từ.
- Mỗi nhân vật phải có cách nói dễ nhận biết: từ vựng, độ dài câu, nhịp và thói quen lời nói.
- Trong cảnh đông người, không viết “mọi người đồng loạt kinh ngạc”; hãy chọn một hoặc hai phản ứng cụ thể.

## 4. Sáu trụ cột nhập vai

1. **Cung cấp thông tin**: Một câu thoại có thể cho thấy thân phận, địa vị và tính cách.
2. **Cụ thể và trực quan**: Chi tiết phải đủ rõ để người đọc hình dung được cảnh vật.
3. **Cảm giác quen thuộc**: Những trải nghiệm đời thường tạo kết nối tự nhiên.
4. **Đồng cảm**: Khó khăn của nhân vật chính phải chạm đến trải nghiệm phổ quát như bất công, bị xem thường hoặc bị chèn ép.
5. **Động cơ ham muốn**: Tạo khoảng trống cảm xúc → khiến người đọc chờ đợi giải tỏa → giải tỏa vượt kỳ vọng.
6. **Năm giác quan**: Thị giác, thính giác, khứu giác, xúc giác và vị giác.

## 5. Leo thang cảm xúc

Không sửa một cảnh đời thường nhàm chán chỉ bằng cách cắt bỏ nó; hãy thêm động lực:
1. **Thêm nguyên nhân và hệ quả**: Về nhà sau giờ làm → vừa nhận cuộc gọi đòi nợ → cảnh thường ngày lập tức có sức ép.
2. **Leo thang liên tục**: Xếp các rắc rối nối tiếp nhau, mỗi lớp nghiêm trọng hơn lớp trước.
3. **Phục vụ tuyến chính**: Mỗi cảnh yên tĩnh phải gieo gợi mở, thúc đẩy quan hệ hoặc tạo tương phản.

## 6. Danh sách tự kiểm tra trước khi viết

1. Chương này tương ứng với nút nào trong dàn ý và có thúc đẩy nút đó không?
2. Lựa chọn tối ưu của nhân vật chính lúc này là gì?
3. Ai khởi phát xung đột, và vì sao họ buộc phải làm vậy?
4. Nhân vật phụ hoặc đối thủ có mục tiêu và biện pháp đáp trả rõ ràng không?
5. Mỗi nhân vật nắm thông tin gì? Có ai biết điều họ không thể biết không?
6. Cuối chương có gợi mở khiến người đọc muốn tiếp tục không?
7. Có đoạn nào giống bản liệt kê sự kiện không? Nếu có, hãy thêm quan hệ nhân quả hoặc cảm xúc mạnh.
8. Chương này có thúc đẩy tuyến truyện chính không?`;
}

function buildEnglishMethodology(): string {
  return `---

# Writing Methodology Reference (Full Version)

Complete reference material for writing quality. Internalize these principles.

## 1. Anti-AI Pattern Guide

### Emotion
| Bad (AI-like) | Good (Human) | Key |
|---|---|---|
| He felt very angry. | He crushed the teacup in his hand. Scalding water ran through his fingers, but he didn't flinch. | Externalize through action |
| She was very sad and tears fell. | She gripped her phone until her knuckles went white. The chat log blurred. | Body detail replaces label |

### Transitions
| Bad | Good | Key |
|---|---|---|
| Although he was strong, he still lost. | He was strong, sure. But the old bastard across from him fought dirtier. | Colloquial voice |
| However, things were not so simple. | No such luck. | Character thought replaces "however" |
| Therefore, he decided to take action. | He stood up and kicked the chair aside. | Cut causal connectors, show action |

## 2. Six-Step Character Psychology

For every important character action:
1. **Situation**: What's the character facing? What cards do they hold?
2. **Core motivation**: What do they want most? Fear most?
3. **Information boundary**: What do they know? Not know? Misjudge?
4. **Personality filter**: Given the same situation, how would THIS character react?
5. **Behavioral choice**: Based on 1-4, what do they choose?
6. **Emotional expression**: What emotion accompanies this? Body language, expression, tone?

## 3. Supporting Character Design

- Every side character has their own agenda. Protagonist wins by outsmarting smart people.
- Core tag + contrast detail = alive (cold-exterior character secretly feeds strays).
- Establish character through events, not description dumps.
- Different characters speak differently — vocabulary, length, verbal tics.
- In group scenes: never "everyone gasped" — pick 1-2 specific reactions.

## 4. Immersion Pillars

1. **Info delivery**: One line of dialogue can establish identity, status, personality
2. **Concrete/visual**: "The back seat of a taxi stuck in traffic for forty minutes" not "a big city"
3. **Familiarity**: Scenes readers have lived through carry natural immersion
4. **Resonance**: Protagonist's struggle must feel universal — injustice, being underestimated
5. **Desire engine**: Create emotional gap → reader anticipates release → release exceeds expectation
6. **Five senses**: Wet shirt on the back, hospital disinfectant, rain puddles at the bus stop

## 5. Emotional Escalation (Anti-Flowchart)

Fix boring daily scenes by adding fuel:
1. **Add causality**: Coming home → add "debt collector just called" → instant urgency
2. **Progressive escalation**: Stack bad things — scolded → missed bus → phone fell in drain → livestream ended → choked on stale bread. Each layer worse.
3. **Daily serves mainline**: Every quiet scene must plant a hook, advance a relationship, or build contrast.

## 6. Pre-Write Checklist

1. Which outline node does this chapter correspond to?
2. What's the protagonist's optimal move right now?
3. Who starts the conflict and why must they?
4. Do antagonists have clear motives and countermoves?
5. What information does each character have? Any boundary violations?
6. Does the chapter end with a hook?
7. Any flowchart passages? If so, add causality or strong emotion.
8. Does this chapter advance the main plotline?`;
}
