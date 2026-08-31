export type WritingLanguage = "vi" | "en";

/**
 * Suy luận ngôn ngữ viết từ brief/premise khi người dùng không chỉ định rõ.
 *
 * Thiết kế bảo thủ: mặc định là "vi" (tiếng Việt) và chỉ trả về "en" khi văn bản
 * rõ ràng là Latin thuần túy. Văn bản có dấu tiếng Việt luôn được nhận diện là "vi".
 */
export function inferLanguage(text?: string | null): WritingLanguage {
  const t = text ?? "";
  const hasVietnameseDiacritics = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/.test(t);
  if (hasVietnameseDiacritics) return "vi";
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  if (latin > 0) return "en";
  return "vi";
}
