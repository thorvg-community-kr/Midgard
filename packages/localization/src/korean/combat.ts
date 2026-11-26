import type { Phrases } from '../phrases';

/** Army controls, orders, skills, swarms and dens, the worlds beyond gates, the downed and the memorial. */
export const combatPhrases: Phrases = {
  // Army keys and the fighters at hand
  'No fighters available.': '대기 중인 전투원이 없습니다.',
  'No one selected can hold here': '선택한 정착민 중 이곳을 사수할 수 있는 이가 없습니다',
  'Select a resident first.': '먼저 정착민을 선택하세요.',
  'No one can reach {0}': '{0}에게 갈 수 있는 이가 없습니다',

  // Control groups
  'Group {0} is empty': '{0}번 부대가 비었습니다',
  'Group {0}: {1}': '{0}번 부대: {1}',
  '{0} down · Average health {1}%': '쓰러짐 {0}명 · 평균 체력 {1}%',
  'Average health {0}%': '평균 체력 {0}%',
  'Double-tap to center.': '두 번 탭하면 부대로 이동합니다.',
  'Ctrl+{0} to assign, Shift+{1} to add': 'Ctrl+{0} 지정, Shift+{1} 추가',
  'Make group {0}': '{0}번 부대 지정',

  // Key hints beyond a gate
  'Q / W skills  ·  H hold or stop  ·  R recall': 'Q / W 기술  ·  H 사수·정지  ·  R 소집',
  'Right-click move  ·  A attack-move  ·  ` party': '우클릭 이동  ·  A 공격 이동  ·  ` 파티',
  'Ctrl+1-9 make a group, 1-9 select it': 'Ctrl+1-9 부대 지정, 1-9 부대 선택',
  'Right-click a downed ally to revive  ·  Space pause': '쓰러진 동료 우클릭: 일으키기  ·  Space 일시 정지',

  // The orders card
  "Choose a destination.": "목적지를 고르세요.",
  "Choose a building.": "지을 건물을 고르세요.",
  'Attack-move': '공격 이동',
  "Fight on the way to the destination.": "목적지로 가며 적과 싸웁니다.",
  Hold: '사수',
  'Hold position': '위치 사수',
  "Defend this spot.": "이 자리를 지킵니다.",
  "Choose a work site.": "일할 곳을 고르세요.",
  'Wake everyone': '모두 깨우기',
  '{0}  ({1})': '{0}  ({1})',
  'No farm stands close enough to work this field': '이 밭을 돌볼 만큼 가까운 농장이 없습니다',
  'The farm by this field has no room for more workers': '이 밭의 농장에는 일꾼 자리가 더 없습니다',

  // Skill names
  Challenge: '도발',
  Whirl: '회전 베기',
  'Aimed Shot': '조준 사격',
  Volley: '화살비',
  'Rune Burst': '룬 폭발',
  'Frost Ring': '서리 고리',
  Mend: '치료',
  Sanctuary: '성역',
  'Rallying Verse': '격려의 노래',
  Dirge: '비탄의 노래',

  // The skill card
  'Q  {0}': 'Q  {0}',
  'W  {0}': 'W  {0}',
  Active: '발동',
  Ready: '준비됨',
  'Auto on': '자동 켬',
  'Auto off': '자동 끔',
  "Turn off auto-use": "자동 사용 끄기",
  "Turn on auto-use": "자동 사용 켜기",
  'Comes at level {0}.': '레벨 {0}에 배웁니다.',
  'Comes at level {0}. {1}': '레벨 {0}에 배웁니다. {1}',
  "Tap the ground to aim.": "지면을 눌러 조준하세요.",
  "Hold {0} to aim, release to cast.": "{0} 키를 눌러 조준하고 떼서 시전하세요.",
  '{0} comes at level {1}': '{0}: 레벨 {1}에 배웁니다',
  '{0} ×{1}': '{0} ×{1}',
  '{0}: {1}/{2} ready': '{0}: {1}/{2} 준비됨',
  '{0}: level {1}': '{0}: 레벨 {1}',

  // Firing skills
  'No one selected has a second skill': '선택한 정착민 중 두 번째 기술이 있는 이가 없습니다',
  'No one selected has a skill': '선택한 정착민 중 기술이 있는 이가 없습니다',
  'Second skills come at level {0}': '두 번째 기술은 레벨 {0}에 배웁니다',
  '{0} is ready in {1} s': '{0}: {1}초 뒤 준비됩니다',
  'Next skill in {0} s': '{0}초 뒤 기술 사용 가능',
  '{0}: no one in reach': '{0}: 닿는 곳에 아무도 없습니다',
  '{0}: release {1} over the ground to cast': '{0}: 땅 위에서 {1} 키를 떼면 시전합니다',
  'Tap the ground for {0}': '{0}: 땅을 탭하세요',
  '{0}: click a spot': '{0}: 위치를 클릭하세요',
  'the skill': '기술',
  'Volley and Frost Ring': '화살비, 서리 고리',
  'Frost Ring and Volley': '서리 고리, 화살비',

  // Beyond a gate: the party panel
  // The list joint splits these first, so each piece has its own key.
  '{0}/{1} dens': '소굴 {0}/{1}',
  '{0}/{1} dens  ·  {2}': '소굴 {0}/{1}  ·  {2}',
  'Dens {0} of {1}': '소굴 {0}/{1}',
  'Monsters {0}': '몬스터 {0}',
  'Dens {0} of {1}  ·  Monsters {2}': '소굴 {0}/{1}  ·  몬스터 {2}',
  'Go home leaves behind: {0}': '귀환하면 남겨지는 이: {0}',
  'Recall party (R)': '파티 소집 (R)',
  '{0}, {1}, level {2}': '{0}, {1}, 레벨 {2}',
  'Downed: bleeds out in {0} s. Select an ally and right-click the body to revive.':
    '쓰러짐: {0}초 뒤 숨을 거둡니다. 동료를 선택하고 쓰러진 이를 우클릭해 일으키세요.',
  "Bleeding out · {0} s": "출혈 · {0}초",
  '{0} is ready': '{0} 준비됨',
  '{0} in {1} s': '{0}: {1}초 뒤',

  // Swarms and dens (the banner detail is one line: keep it short)
  'A den is destroyed': '소굴을 부쉈습니다',
  'The last den is destroyed': '마지막 소굴을 부쉈습니다',
  'The brood breaks': '무리가 무너집니다',
  'A raid wave of {0} comes from the {1}': '{1}에서 습격대 {0}마리가 몰려옵니다',
  'A den is destroyed ({0} left)': '소굴을 부쉈습니다 ({0}곳 남음)',
  'The guardian has fallen; {0} den still breeds': '수호자가 쓰러졌습니다. 소굴 {0}곳이 아직 몬스터를 낳습니다',
  'The guardian has fallen; {0} dens still breed': '수호자가 쓰러졌습니다. 소굴 {0}곳이 아직 몬스터를 낳습니다',
  'What was left of the brood dies with it ({0})': '남은 무리도 함께 죽었습니다 ({0})',
  'The guardian roars and its brood answers': '수호자가 포효하자 무리가 응답합니다',

  // The expedition forecast
  'too few to stand against a swarm': '몬스터 떼를 막기에는 수가 너무 적습니다',
  'likely to lose this floor': '이 층에서 질 가능성이 큽니다',
  'a hard fight': '힘든 싸움이 됩니다',
  ready: '준비되었습니다',
  'Selected: {0} at level {1} on average, {2}.': '선택: {0}명, 평균 레벨 {1}. {2}.',
  'Your fighters: {0} at level {1} on average, {2}.': '전투원: {0}명, 평균 레벨 {1}. {2}.',

  // The guardian
  'Select a rescuer.': '구조할 정착민 선택',
  'Send an ally to help {0}.': '{0}에게 동료를 보내세요.',
  'The guardian of {0} is roused': '{0}의 수호자가 깨어났습니다',
  'this world': '이 세계',
  'Avoid the marked ground.': '표시된 곳을 피하세요.',
  'Guardian of {0}': '{0}의 수호자',
  Enraged: '격노',
  'Slam in {0} s': '내려찍기까지 {0}초',

  // The downed and the auto-pause
  '{0} is down': '{0}이(가) 쓰러졌습니다',
  '{0} has died': '{0}이(가) 세상을 떠났습니다',
  '{0} and {1} are down': '{0}, {1}이(가) 쓰러졌습니다',
  '{0} residents are down': '정착민 {0}명이 쓰러졌습니다',
  'Go to them': '찾아가기',
  'Go to it': '살펴보기',
  Resume: '다시 진행',
  'Resume (Space)': '다시 진행 (Space)',
  '{0} is bleeding out': '{0}이(가) 피를 흘리고 있습니다',
  '+{0} more down': '+{0}명 더 쓰러짐',
  'Downed. Send help.': '쓰러짐. 도와줄 정착민을 보내세요.',
  'Beyond the gate.': '관문 너머에 있습니다.',
  '{0} is down and bleeding out': '{0}이(가) 쓰러져 피를 흘리고 있습니다',
  '{0} is back on their feet': '{0}이(가) 다시 일어섰습니다',
  '{0} has died of their wounds': '{0}이(가) 상처로 숨을 거두었습니다',
  '{0} was killed by the guardian': '{0}: 수호자에게 죽었습니다',
  '{0} was left behind beyond {1}': '{0}이(가) {1} 너머에 남겨졌습니다',
  '{0} would be left behind to die': '{0}은(는) 남겨져 죽게 됩니다',
  '{0}. {1} would be left behind to die': '{0}. {1}은(는) 남겨져 죽게 됩니다',
  '{0} casts the fallen party back out, gravely wounded; the spoils are lost':
    '{0}이(가) 쓰러진 파티를 밖으로 내던졌습니다. 모두 크게 다쳤고 전리품을 잃었습니다',

  // Causes of death
  'Killed by monsters': '몬스터에게 목숨을 잃음',
  'Killed by the guardian': '수호자에게 목숨을 잃음',
  'Killed by a provoked giant': '성난 거인에게 목숨을 잃음',
  'Killed by {0}': '{0}에게 목숨을 잃음',
  'Killed by a {0}': '{0}에게 목숨을 잃음',
  'Died of wounds': '상처로 숨짐',
  Starved: '굶어 죽음',
  'Died of the cold': '얼어 죽음',
  'Left behind beyond {0}': '{0} 너머에 남겨짐',
  wolf: '늑대',
  cow: '소',
  pig: '돼지',
  chicken: '닭',
  dog: '개',
  cat: '고양이',

  // The memorial
  '{0} will be missed at the fire.': '모닥불 곁의 모두가 {0}을(를) 그리워할 것입니다.',
  'The settlement will remember {0}.': '정착지는 {0}을(를) 기억할 것입니다.',
  'Rest now, {0}; others keep the watch.': '이제 쉬어요, {0}. 남은 이들이 자리를 지킵니다.',
  "{0}'s place at the table stays empty tonight.": '오늘 밤 식탁의 {0} 자리는 비어 있습니다.',
  '{0} in {1}, on day {2}.': '{2}일째, {1}에서 {0}.',
  // Outweighs 'Left behind beyond {0}', which would otherwise swallow the place and the day.
  'Left behind beyond {0} in {1}, on day {2}.': '{2}일째, {1}에서 {0} 너머에 남겨짐.',
  '{0} kill': '처치 {0}',
  '{0} kills': '처치 {0}',
  '{0} day in the settlement': '정착지에서 {0}일',
  '{0} days in the settlement': '정착지에서 {0}일',
  'their first day in the settlement': '정착지에서의 첫날',
  '{0} more to remember': '기억할 이가 {0}명 더 있습니다',
  Farewell: '작별',

  // Floating combat words
  Block: '막음',
  DOWN: '쓰러짐',
};
