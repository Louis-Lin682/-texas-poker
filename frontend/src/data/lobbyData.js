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
    imageUrl: '/quick-actions/checkin.png',
    label: '簽到獎勵',
    meta: 'Bonus',
    accent: '#8f63ff',
    accentSoft: 'rgba(143, 99, 255, 0.24)',
    action: 'checkin',
  },
  {
    imageUrl: '/quick-actions/rank.png',
    label: '排行榜',
    meta: 'Rank',
    accent: '#f0c96b',
    accentSoft: 'rgba(240, 201, 107, 0.24)',
    route: '/rank',
  },
  {
    imageUrl: '/quick-actions/event.png',
    label: '限時活動',
    meta: 'Event',
    accent: '#57d46f',
    accentSoft: 'rgba(87, 212, 111, 0.24)',
    route: '/event',
  },
  {
    imageUrl: '/quick-actions/quest.png',
    label: '任務中心',
    meta: 'Quest',
    accent: '#ffb58a',
    accentSoft: 'rgba(255, 181, 138, 0.2)',
    route: '/quest',
  },
  {
    imageUrl: '/quick-actions/news.png',
    label: '最新消息',
    meta: 'News',
    accent: '#4fd0ff',
    accentSoft: 'rgba(79, 208, 255, 0.22)',
    route: '/news',
  },
]

export const promoCards = [
  {
    title: '每日簽到',
    text: '連續登入即可領取籌碼與豪華獎勵，天數越高，回饋越豐厚。',
    action: '立即前往',
    imageUrl: '/promos/daily-checkin-banner.png',
  },
  {
    title: '限時儲值優惠',
    text: '指定期間完成儲值可獲得額外回饋，進桌前先把火力補滿。',
    action: '立即查看',
    imageUrl: '/promos/recharge-offer-banner.png',
  },
]

export const bottomNavItems = [
  { label: '活動', active: false, type: 'icon', icon: '/quick-actions/event.png' },
  { icon: '/phantom-footer-logo.png', label: '遊戲', active: true, type: 'image' },
  { label: '我的', active: false, type: 'icon', iconType: 'profile' },
]
