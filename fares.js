import { nearestRoad, routeTo } from './navigation.js';

/**
 * Original fictional Egyptian taxi satire. Prices are game points, not tariffs.
 * No DOM/Three.js dependency; update with seconds and {x,z,speed,health,distance?}.
 * cashDelta/tripsDelta are cumulative: consume payment events OR delta changes,
 * never both. Passing appearance objects has no effect on price or willingness.
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = (p, fallbackName = 'الشارع اللي بعده') => ({
  x: Number(p.x), z: Number(p.z), name: String(p.name || fallbackName), arabic: String(p.arabic || p.name || fallbackName),
});

function normalizeRoads(roads) {
  if (roads?.segments?.some(s => s.points?.length > 1)) return roads;
  if (roads?.vertical?.length && roads?.horizontal?.length) {
    const xs = [...roads.vertical].sort((a, b) => a - b), zs = [...roads.horizontal].sort((a, b) => a - b);
    return { segments: [
      ...xs.map((x, i) => ({ id: `legacy-v${i}`, points: zs.map(z => ({ x, z })) })),
      ...zs.map((z, i) => ({ id: `legacy-h${i}`, points: xs.map(x => ({ x, z })) })),
    ] };
  }
  throw new TypeError('Fare system needs road polylines or a connected road grid.');
}

/** Move on the actual road polyline, rather than inventing a perpendicular road. */
function pickupAhead(player, roads, metres) {
  const road = nearestRoad(player, roads), segment = roads.segments[road.segmentIndex];
  if (!segment) return { x: player.x, z: player.z };
  const pts = segment.points, a = pts[road.edgeIndex], b = pts[road.edgeIndex + 1];
  const heading = Number(player.heading) || 0;
  const dot = (b.x - a.x) * -Math.sin(heading) + (b.z - a.z) * -Math.cos(heading);
  const direction = segment.oneway === 1 ? 1 : segment.oneway === -1 ? -1 : dot >= 0 ? 1 : -1;
  let current = { x: road.x, z: road.z }, index = direction > 0 ? road.edgeIndex + 1 : road.edgeIndex;
  while (metres > 0 && index >= 0 && index < pts.length) {
    const end = pts[index], length = distance(current, end);
    if (length > metres) { const t = metres / length; return { x: current.x + (end.x - current.x) * t, z: current.z + (end.z - current.z) * t }; }
    current = { x: end.x, z: end.z }; metres -= length; index += direction;
  }
  return current;
}

// The props are cosmetic scene hooks. They never rank people or alter mechanics.
const scenes = [
  { key: 'groceries', label: 'راكب المشتريات', detail: 'شايل كيسين خضار وبيحاول ينقذ الطماطم.', line: 'على مهلك في المطبات. الطماطم دي داخلة البيت سليمة أو عصير، ومش عارفين لسه.' },
  { key: 'suitcase', label: 'راكب الشنطة', detail: 'شنطة سفر صغيرة وصبر أصغر منها.', line: 'الشنطة في الشنطة، وأنا على الكرسي. نبقى كده حلّينا أزمة التخطيط العمراني.' },
  { key: 'formal', label: 'راكب القميص المكوي', detail: 'قميص مكوي وملف ورق، والمشوار عادي.', line: 'القميص مكوي، مش معنى كده إن معايا ميزانية وزارة. نتفق على الأجرة الأول.' },
  { key: 'carton', label: 'راكب الكرتونة', detail: 'كرتونة مقفولة مكتوب عليها: فوق.', line: 'الكرتونة مش هتركب قدام. هي أصلاً حساسة من المناقشات الاقتصادية.' },
  { key: 'folder', label: 'راكب الملف', detail: 'ملف أوراق مربوط بأستك فقد الأمل.', line: 'آخر مشوار ورق النهارده. لو الأستك فرقع، اعتبرنا فتحنا فرع للمصلحة جوه التاكسي.' },
  { key: 'empty', label: 'راكب على الله', detail: 'لا شنط ولا طلبات. عايز يوصل وخلاص.', line: 'معنديش شنط ولا فكة ولا طاقة لجدال. ناقص بس أعرف رايحين على كام.' },
  { key: 'flowers', label: 'راكب الورد', detail: 'بوكيه ورد محتاج يوصل قبل ما يدبل.', line: 'معايا ورد. لو لفّينا كتير هنوصل بخضار ورقي ونقولها مفاجأة.' },
  { key: 'takeaway', label: 'راكب الأكل', detail: 'أكياس أكل سخن، والزحمة عندها رأي تاني.', line: 'الطلب سخن. لو وصل بارد هنكون قدّمنا تجربة تاريخية، مش عشا.' },
];

const dialogue = {
  driverAsk: [
    'رايح فين؟ بس قول المكان كله. كلمة «قريب» دي بوابة لعوالم تانية.',
    'على فين يا أستاذ؟ نتفق وإحنا على الرصيف بدل اجتماع طارئ عند النزول.',
    'فين بالظبط؟ عند أول الشارع ولا عند الباب اللي هيختبر ضميري؟',
    'الوجهة الأول. أنا والجي بي إس علاقتنا احترام متبادل من بعيد.',
  ],
  reject: [
    'مش رايح. التاكسي النهارده عنده ارتباطات أكتر مني.',
    'مش رايح الناحية دي. العربية مستقلة بقرارها وأنا مجرد شاهد.',
    'مش رايح. أنا بختار المشوار لحد ما البنزين يختارني.',
    'لأ، اللفة دي هتخليني أراجع اختياراتي في الحياة.',
  ],
  rejectionReply: [
    'تمام. كده عرفت جدول أعمال العربية. فاضل ألاقي تاكسي شغال توصيل.',
    'ولا يهمك. هكمل مشي، يمكن رجلي توافق على الوجهة.',
    'يعني حضرتك واقف للمشاهدة؟ حقك، النيل حلو.',
    'ماشي. أول مرة أطلب مشوار ويتعملّي مقابلة قبول.',
  ],
  appearanceReply: [
    'الشنطة مش هي اللي هتدفع يا كابتن. أنا اللي راكب، والمشوار هو المشوار.',
    'هو الكرسي بيختار الركاب من الشنط؟ ولا الكرتونة محتاجة تزكية؟',
    'القميص ده مكوي مش سند استثماري. نتكلم في الطريق أحسن.',
    'الأكياس مش ركاب زيادة. لحد دلوقتي محدش فيهم طلب ينزل.',
  ],
  boarding: [
    'ركبنا. اقفل الباب براحة؛ العربية مش ناقصة بيان استنكار.',
    'اتفضل. اللي ماسك الباب يمسك أعصابه معاه.',
    'يلا بينا. الكرسي ثابت، باقي تفاصيل الرحلة قابلة للنقاش.',
    'اركب. نبدأ المشوار قبل ما العداد يطلع معاش.',
  ],
  poolComplaint: [
    'إحنا اتفقنا على مشوار ولا اكتتاب عام في الكنبة؟',
    'أنا حجزت تاكسي، ما حجزتش مقعد في لجنة مواصلات.',
    'كل شوية واحد جديد! هو التاكسي بيلمّ طاقم قبل الإقلاع؟',
    'يا كابتن أنا دافع مشوار، مش مشارك في جولة تعارف.',
    'طب وزّع علينا أرقام وننادي المحطة الجاية بالاسم.',
  ],
  poolHonest: [
    'طالما الطريق واضح والأجرة أقل، نمشيها. بس ما نفتحش فرع تاني في النص.',
    'اتفقنا على المشاركة. المشاركة في الطريق، مش في قرارات حياتي.',
    'ماشي. نفس السكة وأجرة أقل. أول اتفاق جوه التاكسي يتفهم من أول مرة.',
  ],
  crowded: [
    'أربعة ركاب. الكنبة بقت تعرف أسرار المنطقة كلها.',
    'إحنا أربعة وكل واحد رايح حتة. الجي بي إس طلب أجازة من شوية.',
    'الكنبة الخلفية بتعلن إنها اكتفت اجتماعيًا.',
  ],
  detour: [
    'إحنا بنقرب من المكان ولا بنلف عليه لحد ما يغيّر عنوانه؟',
    'اللفة دي لو كانت رواية كنا دخلنا الجزء التالت.',
    'يا كابتن، المكان في المنصورة برضه. مش محتاجين نودّعه من كل الاتجاهات.',
    'من فضلك بلاش تحميل تاني. أنا موعدي مش اقتراح.',
  ],
  timeout: [
    'نزّلني عند أول وقفة آمنة. أنا كده قضيت مع العربية أكتر من المكان اللي رايحه.',
    'كفاية لحد هنا. أنا اللي طلبت تاكسي، مش طلبت بداية جديدة.',
    'وقف على جنب. هكمل مشي قبل ما المشوار يبقى ذكرى طفولة.',
  ],
  goodArrival: [
    'وصلنا عند المكان فعلًا! ده مشوار يستاهل يتحط في الأرشيف.',
    'أهي دي الأجرة. الاتفاق طلع ينفع يعيش لحد آخر الشارع.',
    'تسلم. لا تحقيق عند الركوب ولا مؤتمر عند النزول. تجربة غريبة وجميلة.',
    'عند الباب ومن غير خناقة؟ أنا كده مش عارف أحكي لأصحابي إيه.',
  ],
  badArrival: [
    'خد اللي اتفقنا عليه بعد خصم اللفة. أنا ركبت أوصل، مش أقيس محيط المدينة.',
    'وصلنا أخيرًا. الأجرة دي على قد المشوار، والشكوى على قد التجربة.',
    'نزلني هنا. سيبنا جزء من العمر معاك، مش هنسيب الأجرة كلها كمان.',
  ],
  idle: [
    'السواق: «أنا مش بزوّد الأجرة. أنا بختبر قوة العلاقة بين المواطن والرصيف.»',
    'الراديو ساكت. واضح إنه مش عايز يدخل طرف في الحوار.',
    'السواق: «كل الناس مستعجلة. الشارع بس اللي واخد اليوم إجازة.»',
    'العداد منوّر. مش لازم كل حاجة منوّرة تكون سعيدة.',
    'السواق: «خمس دقايق وأوصل. الجملة دي عندها أقدمية أكتر من العربية.»',
  ],
  refusalSpam: [
    'السمعة نزلت. الزباين بقوا يسألوك «رايح فين إنت؟» قبل ما يوقفوك.',
    'تلات رفضات ورا بعض. الرصيف بقى المنافس الرسمي للتاكسي.',
  ],
};

export function createFareSystem({ landmarks = [], roads, start = { x: 0, z: 0 }, seed = 3407 } = {}) {
  const network = normalizeRoads(roads);
  if (landmarks.length < 2 || landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) throw new TypeError('Fare system needs at least two finite landmarks.');
  const places = landmarks.map(p => point(p));
  const events = [];
  const remainingRoutes = new Map();
  let currentStopId = null;
  let rngState = Number(seed) >>> 0, serial = 0, eventSerial = 0, nextRequest = 0, banterAt = 18, refusalStreak = 0;
  let lastPlayer = { ...start, speed: 0, health: 100 }, lastDistance = Number.isFinite(start.distance) ? start.distance : null;
  const random = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 4294967296; };
  const pick = array => array[Math.floor(random() * array.length)];
  const state = {
    active: false, offer: null, passengers: [], maxPassengers: 4, cashDelta: 0, tripsDelta: 0,
    reputation: 60, driverMood: 65, elapsed: 0, lastLine: '', lastSpeaker: 'narrator',
    completed: 0, abandoned: 0, rejected: 0, complaints: 0, receipts: [], currency: 'GAME EGP',
  };
  const emit = (type, text, extra = {}) => {
    const event = { id: ++eventSerial, type, text, time: state.elapsed, speaker: 'narrator', ...extra };
    events.push(event); state.lastLine = text; state.lastSpeaker = event.speaker;
    return event;
  };
  const speak = (speaker, text, extra) => emit('dialogue', text, { speaker, ...extra });
  const reputation = delta => { const before = state.reputation; state.reputation = clamp(before + delta, 0, 100); return state.reputation - before; };
  const requestDelay = () => 7 + Math.max(0, 55 - state.reputation) * .16;
  const result = (ok, reason, extra = {}) => ({ ok, reason, ...extra });

  function readPlayer(player) {
    if (!player) return lastPlayer;
    if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) throw new TypeError('Player needs finite x and z.');
    lastPlayer = { ...lastPlayer, ...player, speed: Number.isFinite(player.speed) ? player.speed : 0 };
    // distance is optional. Do not retain a stale odometer when an embedding
    // switches to position-only updates: doing so silently erases all detours.
    if (!Number.isFinite(player.distance)) delete lastPlayer.distance;
    return lastPlayer;
  }

  function remainingRoute(rider) {
    const straight = distance(lastPlayer, rider.destination);
    if (straight <= 13) {
      rider.remainingDistance = straight; rider.routeReachable = true;
      return straight;
    }
    let sample = remainingRoutes.get(rider.id);
    const moved = sample ? distance(lastPlayer, sample) : Infinity;
    // At most one road search per rider every two seconds of ordinary driving.
    // Longer jumps refresh immediately; small motion uses a distance correction.
    if (!sample || moved >= 60 || (moved >= 8 && state.elapsed - sample.time >= 2)) {
      const route = routeTo(lastPlayer, rider.destination, network);
      sample = { x: lastPlayer.x, z: lastPlayer.z, time: state.elapsed, straight, length: route.length, reachable: route.reachable !== false };
      remainingRoutes.set(rider.id, sample);
    }
    const length = sample.reachable ? Math.max(0, sample.length + straight - sample.straight) : Infinity;
    rider.remainingDistance = length;
    rider.routeReachable = sample.reachable;
    return length;
  }

  function refreshEarlyExit(rider) {
    if (!rider.wantsOut || Math.abs(lastPlayer.speed) > 3) return;
    const road = nearestRoad(lastPlayer, network);
    // A request to stop is not a demand to reverse to the exact place where
    // patience expired. A later stopped road position is still a valid exit.
    if (road.distance <= 13) rider.exitPoint = point(road, 'نزّلني هنا');
  }

  function makeOffer() {
    if (!state.active || state.offer || state.passengers.length >= state.maxPassengers) return;
    const offset = 34 + random() * 18;
    const pickup = { ...pickupAhead(lastPlayer, network, offset), name: 'راكب بيشاور · على جنب الطريق', arabic: 'واقف على جنب' };
    if (routeTo(lastPlayer, pickup, network).reachable === false) Object.assign(pickup, nearestRoad(lastPlayer, network));
    const available = places.map(p => ({ place: p, route: routeTo(pickup, p, network) })).filter(p => p.route.reachable !== false);
    let candidates = available.filter(p => distance(p.place, pickup) > 100 && !state.passengers.some(r => distance(p.place, r.destination) < 20));
    if (!candidates.length) candidates = available.filter(p => distance(p.place, pickup) > 20);
    if (!candidates.length) candidates = available;
    if (!candidates.length) { nextRequest = 10; return; }
    const chosen = candidates[Math.floor(random() * candidates.length)];
    const destination = { ...chosen.place }, directDistance = chosen.route.length;
    const baseFare = Math.max(25, Math.round((20 + directDistance * .07) / 5) * 5);
    const scene = { ...scenes[serial % scenes.length] };
    const id = `rider-${++serial}`;
    const existing = state.passengers.map(r => r.destination);
    const routeCompatible = !existing.length || existing.some(d => {
      const ax = d.x - pickup.x, az = d.z - pickup.z, bx = destination.x - pickup.x, bz = destination.z - pickup.z;
      return (ax * bx + az * bz) / Math.max(1, Math.hypot(ax, az) * Math.hypot(bx, bz)) > .25 || distance(d, destination) < 240;
    });
    state.offer = {
      id, name: scene.label, label: scene.label, persona: scene.label, scene, appearance: scene.detail,
      pickup: point(pickup), destination, baseFare, fare: baseFare,
      directDistance, askedDestination: false, routeShared: false, routeCompatible,
      routeSummary: existing.map(d => d.arabic).join(' ← '), accepted: false,
      haggleCount: 0, haggled: false, secondsLeft: 48, maxSeconds: 48, patience: 100,
      maxWilling: Math.round(baseFare * (1.15 + random() * .35)), dialogue: scene.line,
    };
    emit('offer', scene.line, { speaker: 'passenger', passengerId: id, offer: { ...state.offer, scene: { ...scene }, pickup: { ...state.offer.pickup }, destination: { ...destination } } });
  }

  function askDestination() {
    const o = state.offer;
    if (!o || o.accepted) return result(false, 'no-offer');
    if (o.askedDestination) return result(true, 'already-asked', { offer: o });
    o.askedDestination = true;
    speak('driver', pick(dialogue.driverAsk), { passengerId: o.id });
    o.dialogue = `على ${o.destination.arabic}. والأجرة ${o.fare}، متفقين من دلوقتي. مش هنسيبها لاجتماع عند النزول.`;
    speak('passenger', o.dialogue, { passengerId: o.id });
    return result(true, 'destination-revealed', { offer: o });
  }

  function shareRoute() {
    const o = state.offer;
    if (!o || o.accepted) return result(false, 'no-offer');
    if (o.routeShared) return result(true, 'already-shared', { offer: o });
    o.routeShared = true;
    if (!o.askedDestination) askDestination();
    if (state.passengers.length) {
      o.fare = Math.max(20, Math.round(o.fare * .82));
      o.dialogue = o.routeCompatible ? pick(dialogue.poolHonest) : 'المشوار مش نفس السكة أوي. هنشارك بس اللفة تتقال بصراحة، وأجرتي أقل زي ما اتفقنا.';
      speak('driver', `معانا ${state.passengers.length}، ونازلين عند ${o.routeSummary}. أجرتك بالمشاركة ${o.fare}. موافق قبل ما تركب؟`, { passengerId: o.id });
      speak('passenger', o.dialogue, { passengerId: o.id });
    } else {
      o.dialogue = 'لو هتركّب حد في الطريق قول قبلها، مش بعد ما الكنبة تبقى جمعية عمومية.';
      speak('passenger', o.dialogue, { passengerId: o.id });
    }
    return result(true, 'route-disclosed', { offer: o });
  }

  function accept(options = {}) {
    const o = state.offer;
    if (!state.active || !o) return result(false, 'no-offer');
    if (o.accepted) return result(true, 'already-accepted', { offer: o });
    if (state.passengers.length >= state.maxPassengers) return result(false, 'full');
    if (options?.shared || options?.shareRoute) shareRoute();
    o.accepted = true; o.maxSeconds = 100; o.secondsLeft = o.maxSeconds; refusalStreak = 0;
    speak('driver', o.haggled ? `اتفقنا على ${o.fare}. والاتفاق مش بيتغير لما نوصل.` : 'اتفضل. الأجرة واضحة، والمكان هو اللي اتقال. نخلي الخناقة لزحمة الشارع.', { passengerId: o.id });
    emit('accepted', 'الراكب مستنيك توقف جنبه. E للركوب.', { passengerId: o.id });
    return result(true, 'accepted', { offer: o });
  }

  function reject(reason = 'route') {
    const o = state.offer;
    if (!o) return result(false, 'no-offer');
    const repLoss = reason === 'appearance' ? -6 : o.accepted ? -5 : -2;
    const delta = reputation(repLoss);
    state.driverMood = clamp(state.driverMood + 3, 0, 100); state.rejected++; refusalStreak++;
    speak('driver', reason === 'appearance' ? 'بصراحة الشنط والطلبات دي مش على مزاج الكنبة النهارده.' : pick(dialogue.reject), { passengerId: o.id });
    speak('passenger', reason === 'appearance' ? pick(dialogue.appearanceReply) : pick(dialogue.rejectionReply), { passengerId: o.id });
    emit('rejected', 'مشوار اترفض. السمعة بتفتكر حتى لو السواق نسي.', { passengerId: o.id, reputationDelta: delta, reason });
    state.offer = null; nextRequest = requestDelay() + 2;
    if (refusalStreak >= 3) { emit('consequence', pick(dialogue.refusalSpam)); refusalStreak = 0; }
    return result(true, 'rejected');
  }

  function haggle() {
    const o = state.offer;
    if (!o || o.accepted) return result(false, 'no-offer');
    o.haggleCount++; o.haggled = true; o.askedDestination = true; o.patience -= 12;
    // The action is labelled "زود خمسة": raise the current quote by five,
    // including a disclosed shared quote, rather than replacing it with +30%.
    const request = o.fare + 5;
    o.proposedFare = request;
    const repDelta = reputation(o.haggleCount === 1 ? -2 : -4);
    speak('driver', `المشوار ده بـ${request}. أصل اللفة محتاجة تمويل مستقل.`, { passengerId: o.id });
    if (request <= o.maxWilling && o.haggleCount === 1) {
      o.fare = request;
      o.dialogue = `ماشي ${request}، بس مش كل شارع هندخله يبقى بند جديد في الميزانية.`;
      emit('haggled', o.dialogue, { speaker: 'passenger', passengerId: o.id, amount: o.fare, reputationDelta: repDelta });
      return result(true, 'higher-fare', { offer: o });
    }
    if (o.haggleCount === 1) {
      o.dialogue = `لأ. ${o.fare} زي ما اتفقنا الأول. أنا رايح ${o.destination.arabic}، مش بشتريه.`;
      emit('counteroffer', o.dialogue, { speaker: 'passenger', passengerId: o.id, reputationDelta: repDelta });
      return result(true, 'counteroffer', { offer: o });
    }
    emit('walked', 'خلاص، معايا رجلين ولسه ملهمش تعريفة. خليك واقف مع العرض ده.', { speaker: 'passenger', passengerId: o.id, reputationDelta: repDelta });
    state.offer = null; nextRequest = requestDelay() + 4;
    return result(true, 'walked-away');
  }

  function board(o) {
    const others = state.passengers;
    const surprisePool = others.length > 0 && !o.routeShared;
    if (surprisePool) {
      const delta = reputation(-7); state.complaints++;
      for (const rider of others) {
        rider.patience = Math.max(0, rider.patience - 18); rider.undisclosedPickups++;
        rider.mood = 'معترض';
      }
      o.patience -= 12;
      emit('complaint', pick(dialogue.poolComplaint), { speaker: 'passenger', passengerId: others[0].id, reputationDelta: delta });
    } else if (others.length) {
      reputation(1);
      speak('passenger', pick(dialogue.poolHonest), { passengerId: o.id });
    }
    const limit = Math.max(110, o.directDistance / 4 + 65);
    const rider = {
      id: o.id, name: o.name, label: o.label, persona: o.persona, appearance: o.appearance,
      scene: o.scene, pickup: o.pickup, destination: o.destination,
      fare: o.fare, baseFare: o.baseFare, askedDestination: o.askedDestination,
      shared: o.routeShared, haggled: o.haggled, patience: clamp(o.patience, 0, 100),
      mood: surprisePool ? 'مش مقتنع' : 'رايق', secondsOnboard: 0, maxRideSeconds: limit,
      directDistance: o.directDistance, riddenDistance: 0, excessDistance: 0,
      startHealth: Number.isFinite(lastPlayer.health) ? lastPlayer.health : 100, healthLost: 0, undisclosedPickups: 0,
      complaintLevel: 0, wantsOut: false, exitPoint: null,
    };
    others.push(rider); state.offer = null; nextRequest = requestDelay();
    remainingRoutes.set(rider.id, { x: lastPlayer.x, z: lastPlayer.z, time: state.elapsed,
      straight: distance(lastPlayer, rider.destination), length: o.directDistance, reachable: true });
    state.driverMood = clamp(state.driverMood - 2, 0, 100);
    emit('pickup', pick(dialogue.boarding), { speaker: 'driver', passengerId: rider.id, occupancy: others.length });
    if (others.length === 4) speak('passenger', pick(dialogue.crowded), { passengerId: rider.id });
    return rider;
  }

  function finish(rider, early = false) {
    let amount = 0, tip = 0;
    const fair = !rider.haggled && rider.undisclosedPickups === 0;
    if (!early) {
      const satisfaction = clamp(rider.patience / 100, .15, 1);
      const discount = rider.undisclosedPickups ? .82 : 1;
      amount = Math.max(0, Math.round(rider.fare * (.55 + satisfaction * .45) * discount - rider.healthLost * .2));
      if (fair && rider.patience > 75 && rider.healthLost < 5) { tip = Math.max(3, Math.round(rider.baseFare * .1)); amount += tip; }
      state.cashDelta += amount; state.tripsDelta++; state.completed++;
    } else state.abandoned++;
    const delta = reputation(early ? -9 : fair && rider.patience > 60 ? 3 : rider.patience < 35 ? -5 : 0);
    state.passengers = state.passengers.filter(p => p.id !== rider.id);
    remainingRoutes.delete(rider.id);
    if (currentStopId === rider.id) currentStopId = null;
    const receipt = { passengerId: rider.id, destination: rider.destination, amount, tip, quotedFare: rider.fare, early, patience: Math.round(rider.patience), reputationDelta: delta };
    state.receipts.push(receipt); if (state.receipts.length > 24) state.receipts.shift();
    emit(early ? 'abandoned' : 'dropoff', early ? 'الراكب نزل من غير أجرة. اللفة الطويلة أكلت المكسب والسمعة.' : pick(rider.patience > 60 ? dialogue.goodArrival : dialogue.badArrival), { speaker: 'passenger', ...receipt });
    if (!early) emit('payment', `+${amount} من مشوار ${rider.destination.arabic}${tip ? ` · بقشيش ${tip} عشان الاتفاق اتنفّذ` : ''}`, receipt);
    if (!state.offer) nextRequest = Math.min(nextRequest, requestDelay());
    return receipt;
  }

  function getTarget() {
    const unhappy = state.passengers.find(p => p.wantsOut);
    if (unhappy) {
      refreshEarlyExit(unhappy);
      return { ...unhappy.exitPoint, kind: 'dropoff', passengerId: unhappy.id, earlyExit: true, name: 'نزّلني هنا · وقفة آمنة', arabic: 'نزّلني هنا' };
    }
    // Do not hide a passenger's completed stop behind a different accepted
    // pickup. The player can finish the nearby journey before moving on.
    const arrived = state.passengers.filter(p => distance(lastPlayer, p.destination) <= 13)
      .sort((a, b) => distance(lastPlayer, a.destination) - distance(lastPlayer, b.destination))[0];
    if (arrived) return { ...arrived.destination, kind: 'dropoff', passengerId: arrived.id };
    if (state.offer?.accepted || (!state.passengers.length && state.offer)) return { ...state.offer.pickup, kind: 'pickup', passengerId: state.offer.id };
    if (!state.passengers.length) return null;
    const costs = state.passengers.map(rider => ({ rider, length: remainingRoute(rider) }));
    let best = costs.reduce((a, b) => a.length <= b.length ? a : b);
    const previous = costs.find(p => p.rider.id === currentStopId);
    // A few meters of approximation around an intersection must not flicker
    // the route between two riders on every HUD frame.
    if (previous && previous.length <= best.length + 15) best = previous;
    currentStopId = best.rider.id;
    return { ...best.rider.destination, kind: 'dropoff', passengerId: best.rider.id, reachable: best.rider.routeReachable, routeDistance: best.length };
  }

  function interact(player) {
    readPlayer(player);
    if (!state.active) return result(false, 'inactive');
    if (Math.abs(lastPlayer.speed) > 3) { emit('hint', 'وقف الأول. الباب مش معمول للركوب الطائر.'); return result(false, 'moving'); }
    for (const rider of state.passengers) refreshEarlyExit(rider);
    const close = state.passengers.filter(p => distance(lastPlayer, p.wantsOut ? p.exitPoint : p.destination) <= 13);
    const dropped = close.map(p => finish(p, p.wantsOut && distance(lastPlayer, p.destination) > 13));
    let boarded = null;
    if (state.offer?.accepted && distance(lastPlayer, state.offer.pickup) <= 13 && state.passengers.length < state.maxPassengers) boarded = board(state.offer);
    if (dropped.length || boarded) return result(true, boarded ? 'boarded' : 'dropped-off', { dropped, boarded });
    if (state.offer && !state.offer.accepted && distance(lastPlayer, state.offer.pickup) <= 13) { emit('hint', 'اتفق مع الراكب الأول: تقبل، تفاصل، ولا تقول مش رايح؟'); return result(false, 'decide-first'); }
    emit('hint', 'قرّب من العلامة ووقف على جنب. المسافة دي محتاجة مشوار لوحدها.');
    return result(false, 'too-far');
  }

  function startShift(player) {
    readPlayer(player);
    if (state.active) return state;
    state.active = true; nextRequest = 0; banterAt = 18; lastDistance = Number.isFinite(lastPlayer.distance) ? lastPlayer.distance : null;
    emit('shift-start', 'وردية جديدة. أربع كراسي، وكل كرسي عنده وجهة ورأي.'); makeOffer();
    return state;
  }

  function stopShift() {
    if (!state.active) return state;
    for (const rider of [...state.passengers]) finish(rider, true);
    if (state.offer?.accepted) reputation(-2);
    state.offer = null; state.active = false; nextRequest = 0;
    emit('shift-stop', 'الوردية خلصت. العداد ارتاح، والكنبة هتحاول تنسى.');
    return state;
  }

  function update(dt, player) {
    const previous = lastPlayer;
    readPlayer(player);
    if (!Number.isFinite(dt) || dt < 0) throw new TypeError('dt must be finite nonnegative seconds.');
    let travelled = distance(previous, lastPlayer);
    if (Number.isFinite(lastPlayer.distance)) {
      if (lastDistance !== null && lastPlayer.distance >= lastDistance) travelled = lastPlayer.distance - lastDistance;
      lastDistance = lastPlayer.distance;
    } else lastDistance = null;
    if (!state.active || dt === 0) return state;
    // Split large simulation ticks so expiries, protests and new offers agree
    // with normal animation-frame updates. No timers keep running while paused.
    let left = dt;
    while (left > 1e-8) {
      const step = Math.min(left, 1); left -= step; state.elapsed += step;
      if (state.offer) {
        state.offer.secondsLeft -= step;
        if (state.offer.secondsLeft <= 0) {
          const o = state.offer;
          emit('expired', o.accepted ? 'قلت اتفضل وسيبتني على الرصيف؟ كده إحنا بنحجز أمل مش تاكسي.' : 'الراكب كمّل مشي. الرصيف كسب جولة.', { speaker: 'passenger', passengerId: o.id, reputationDelta: o.accepted ? reputation(-3) : 0 });
          state.offer = null; nextRequest = requestDelay();
        }
      } else if (state.passengers.length < state.maxPassengers) {
        nextRequest -= step; if (nextRequest <= 0) makeOffer();
      }
      for (const rider of state.passengers) {
        if (rider.wantsOut) continue;
        rider.secondsOnboard += step; rider.riddenDistance += travelled * step / dt;
        const normalLoss = 100 / rider.maxRideSeconds;
        const loss = normalLoss * step;
        const remaining = remainingRoute(rider);
        const excess = Number.isFinite(remaining) ? Math.max(0, rider.riddenDistance + remaining - rider.directDistance * 1.4 - 100) : rider.excessDistance;
        const extraLoss = Math.max(0, excess - rider.excessDistance) * .035;
        rider.excessDistance = Math.max(excess, rider.excessDistance);
        const healthLost = Math.max(0, rider.startHealth - (Number.isFinite(lastPlayer.health) ? lastPlayer.health : 100));
        const impactLoss = Math.max(0, healthLost - rider.healthLost) * .9; rider.healthLost = Math.max(rider.healthLost, healthLost);
        rider.patience = clamp(rider.patience - loss - extraLoss - impactLoss, 0, 100);
        const level = rider.patience < 25 ? 2 : rider.patience < 55 ? 1 : 0;
        if (level > rider.complaintLevel) {
          rider.complaintLevel = level; rider.mood = level === 2 ? 'آخر صبره' : 'متنرفز'; state.complaints++;
          emit('complaint', pick(dialogue.detour), { speaker: 'passenger', passengerId: rider.id, patience: Math.round(rider.patience) });
        }
        if (rider.patience <= 0) {
          rider.wantsOut = true; rider.exitPoint = point(nearestRoad(lastPlayer, network), 'نزّلني هنا'); rider.mood = 'عايز ينزل';
          emit('exit-request', pick(dialogue.timeout), { speaker: 'passenger', passengerId: rider.id });
        }
      }
      state.driverMood = clamp(state.driverMood + (state.passengers.length ? -.012 * state.passengers.length : .025) * step, 0, 100);
      banterAt -= step;
      if (banterAt <= 0) {
        speak(state.passengers.length >= 3 ? 'passenger' : 'driver', pick(state.passengers.length >= 3 ? dialogue.crowded : dialogue.idle));
        banterAt = 22 + random() * 12;
      }
    }
    return state;
  }

  return {
    state, update, startShift, stopShift, accept, reject, haggle, askDestination, shareRoute, interact, getTarget,
    // Aliases ease embedding in UIs that spell out the offer action.
    acceptOffer: accept, rejectOffer: reject,
    drainEvents() { return events.splice(0); },
  };
}
