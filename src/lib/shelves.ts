export const SHELF_NAME_LIMIT = 30

// BE와 같은 규칙: 앞뒤 공백 제거·NFC 정규화 뒤 코드 포인트 1~30자. 대소문자 무시 중복은 서버가 판단한다(409).
export function shelfName(input: string): { name: string } | { error: string } {
  const name = input.trim().normalize('NFC')
  if (!name) return { error: '책장 이름을 입력해주세요.' }
  if ([...name].length > SHELF_NAME_LIMIT) return { error: `책장 이름은 ${SHELF_NAME_LIMIT}자까지 정할 수 있어요.` }
  return { name }
}
