export const noticeText =
  'Texas Holdem 主桌已開放，其他遊戲目前作為展示內容，更多玩法與限時活動將陸續解鎖。'

export const profile = {
  name: 'Phantom Dealer',
  subtitle: 'Official Lounge',
  balance: '18,000,000,000',
  vip: 'VIP 1',
}

export const quickActions = [
  {
    imageUrl: '/quick-actions/checkin.webp',
    label: '簽到獎勵',
    meta: 'Bonus',
    accent: '#8f63ff',
    accentSoft: 'rgba(143, 99, 255, 0.24)',
    action: 'checkin',
  },
  {
    imageUrl: '/quick-actions/rank.webp',
    label: '排行榜',
    meta: 'Rank',
    accent: '#f0c96b',
    accentSoft: 'rgba(240, 201, 107, 0.24)',
    route: '/rank',
  },
  {
    imageUrl: '/quick-actions/event.webp',
    label: '限時活動',
    meta: 'Event',
    accent: '#57d46f',
    accentSoft: 'rgba(87, 212, 111, 0.24)',
    route: '/event',
  },
  {
    imageUrl: '/quick-actions/quest.webp',
    label: '任務中心',
    meta: 'Quest',
    accent: '#ffb58a',
    accentSoft: 'rgba(255, 181, 138, 0.2)',
    route: '/quest',
  },
  {
    imageUrl: '/quick-actions/news.webp',
    label: '最新消息',
    meta: 'News',
    accent: '#4fd0ff',
    accentSoft: 'rgba(79, 208, 255, 0.22)',
    route: '/news',
  },
]

export const promoCards = []

export const bottomNavItems = [
  { label: '活動', active: false, type: 'icon', icon: '/quick-actions/event.webp' },
  { icon: '/phantom-footer-logo.webp', label: '遊戲', active: true, type: 'image' },
  { label: '我的', active: false, type: 'icon', iconType: 'profile' },
]
