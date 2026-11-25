import { el, externalLink, safeUrl } from './dom.js';
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  REGIONS,
  SORTS,
  WINDOWS,
  countByCategory,
  countdown,
  pulseOf,
  relativeTime,
  selectStories,
  watchMatches,
} from './deskModel.js';

const FEED_LIMIT = 80;
const WIRE_LIMIT = 18;
const AGENDA_KINDS = [
  ['all', 'ALL'],
  ['election', 'VOTES'],
  ['summit', 'SUMMITS'],
  ['economy', 'DATA'],
  ['space', 'SPACE'],
];
const $ = (id) => document.getElementById(id);

/** Render and operate the World Desk over one store. */
export class WorldDesk {
  constructor({ store, actions }) {
    this.store = store;
    this.actions = actions;
    this.search = '';
    this.agendaKind = 'all';
    this.openStoryId = null;
    this.tvChannel = null;
    this.listeners = new AbortController();
    this.root = $('world-desk');
    this._bind();
    this.unsubscribe = store.subscribe((event) => this._onStore(event));
    this.clock = setInterval(() => this._tick(), 1_000);
    this._tick();
    this.renderAll();
  }

  _on(target, type, listener, options = {}) {
    target?.addEventListener(type, listener, {
      ...options,
      signal: this.listeners.signal,
    });
  }

  get open() {
    return !this.root.hidden;
  }

  _bind() {
    for (const button of document.querySelectorAll('[data-workspace]'))
      this._on(button, 'click', () => {
        const workspace = button.dataset.workspace;
        if (workspace === 'africa') {
          this.setOpen(false);
          this.actions.openAfrica();
        } else this.setOpen(workspace === 'desk');
      });
    for (const button of document.querySelectorAll('[data-view]'))
      this._on(button, 'click', () =>
        this.actions.setFraming(button.dataset.view),
      );
    this._on($('desk-search'), 'input', (event) => {
      this.search = event.target.value;
      this.renderFeed();
    });
    this._on($('desk-floor'), 'input', (event) =>
      this.store.setPrefs({ floor: Number(event.target.value) }),
    );
    for (const [id, key] of [
      ['desk-alerts', 'alerts'],
      ['desk-corroborated', 'corroborated'],
      ['desk-hide-read', 'hideRead'],
    ])
      this._on($(id), 'change', (event) =>
        this.store.setPrefs({ [key]: event.target.checked }),
      );
    this._on($('desk-refresh'), 'click', () => void this.store.refresh());
    this._on($('desk-watch-form'), 'submit', (event) => {
      event.preventDefault();
      const input = $('desk-watch-input');
      const term = input.value.trim();
      const { watchlist } = this.store.getPrefs();
      if (
        term.length > 1 &&
        !watchlist.some((item) => item.toLowerCase() === term.toLowerCase())
      )
        this.store.setPrefs({ watchlist: [...watchlist, term] });
      input.value = '';
    });
    this._on($('live-wire-pause'), 'click', (event) => {
      const paused = $('live-wire').classList.toggle('paused');
      event.currentTarget.setAttribute('aria-pressed', String(paused));
      event.currentTarget.textContent = paused ? 'PLAY' : 'PAUSE';
    });
    this._on(document, 'keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target?.closest?.('input, textarea, select, [contenteditable]'))
        return;
      if (event.key === 'n' || event.key === 'N') this.setOpen(!this.open);
      else if (event.key === 'g' || event.key === 'G') this.setOpen(false);
    });
    this._on(
      document,
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !this.open) return;
        event.stopPropagation();
        this.setOpen(false);
      },
      { capture: true },
    );
  }

  setOpen(open) {
    this.root.hidden = !open;
    document.body.classList.toggle('desk-open', open);
    for (const button of document.querySelectorAll('[data-workspace]')) {
      const active = button.dataset.workspace === (open ? 'desk' : 'globe');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (open) {
      this.actions.closeCard();
      this.renderAll();
      this.root.focus({ preventScroll: true });
    } else this._stopTv();
  }

  syncFraming(circle) {
    for (const button of document.querySelectorAll('[data-view]'))
      button.setAttribute(
        'aria-checked',
        String((button.dataset.view === 'circle') === circle),
      );
  }

  _onStore({ reason, alerts = [] }) {
    if (reason === 'news') {
      this.renderWire();
      this.renderPulse();
      for (const story of alerts) this.showAlert(story);
      this.renderUnread();
    }
    if (reason === 'loading') {
      $('desk-refresh').textContent = 'READING…';
      return;
    }
    if (this.open) {
      if (reason === 'calendar') this.renderAgenda();
      else if (reason === 'markets') this.renderMarkets();
      else this.renderAll();
    }
  }

  _tick() {
    const now = new Date();
    const format = (timeZone) =>
      now.toLocaleTimeString('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    $('clock-utc').textContent = format('UTC');
    $('clock-kigali').textContent = format('Africa/Kigali');
  }

  _stories() {
    return this.store.state.news?.stories || [];
  }

  renderAll() {
    this.renderControls();
    this.renderFeed();
    this.renderHotspots();
    this.renderTrends();
    this.renderAgenda();
    this.renderMarkets();
    this.renderTv();
    this.renderSources();
    this.renderWire();
    this.renderPulse();
    this.renderUnread();
  }

  _radioChips(container, options, current, onPick) {
    container.replaceChildren(
      ...options.map(([value, label]) =>
        el('button', {
          type: 'button',
          role: 'radio',
          class: `desk-chip${value === current ? ' active' : ''}`,
          'aria-checked': String(value === current),
          text: label,
          onClick: () => onPick(value),
        }),
      ),
    );
  }

  renderControls() {
    const prefs = this.store.getPrefs();
    this._radioChips($('desk-regions'), REGIONS, prefs.region, (region) =>
      this.store.setPrefs({ region }),
    );
    this._radioChips(
      $('desk-windows'),
      WINDOWS,
      prefs.windowHours,
      (windowHours) => this.store.setPrefs({ windowHours }),
    );
    this._radioChips($('desk-sort'), SORTS, prefs.sort, (sort) =>
      this.store.setPrefs({ sort }),
    );
    const counts = countByCategory(this._stories(), prefs, {
      search: this.search,
    });
    $('desk-categories').replaceChildren(
      ...CATEGORY_IDS.map((id) => {
        const on = !prefs.hidden.includes(id);
        return el(
          'div',
          { class: 'desk-category', dataset: { category: id } },
          el(
            'button',
            {
              type: 'button',
              class: 'desk-category-toggle',
              'aria-pressed': String(on),
              title: on ? 'Hide this desk' : 'Show this desk',
              onClick: () =>
                this.store.setPrefs({
                  hidden: on
                    ? [...prefs.hidden, id]
                    : prefs.hidden.filter((item) => item !== id),
                }),
            },
            el('i', { 'aria-hidden': 'true' }),
            el('span', { text: CATEGORY_LABELS[id] }),
            el('b', { text: String(counts[id]) }),
          ),
          el('button', {
            type: 'button',
            class: 'desk-only',
            text: 'ONLY',
            'aria-label': `Show only ${CATEGORY_LABELS[id]}`,
            onClick: () => {
              const others = CATEGORY_IDS.filter((item) => item !== id);
              const alone = others.every((item) => prefs.hidden.includes(item));
              this.store.setPrefs({
                hidden: alone ? ['entertainment'] : others,
              });
            },
          }),
        );
      }),
    );
    $('desk-floor').value = String(prefs.floor);
    $('desk-floor-value').textContent = prefs.floor ? `${prefs.floor}+` : 'ALL';
    $('desk-alerts').checked = prefs.alerts;
    $('desk-corroborated').checked = prefs.corroborated;
    $('desk-hide-read').checked = prefs.hideRead;
    $('desk-watchlist').replaceChildren(
      ...prefs.watchlist.map((term) =>
        el(
          'span',
          { class: 'desk-chip desk-watch' },
          el('button', {
            type: 'button',
            class: 'desk-watch-term',
            text: term,
            title: 'Search for this',
            onClick: () => this._searchFor(term),
          }),
          el('button', {
            type: 'button',
            class: 'desk-watch-remove',
            text: '×',
            'aria-label': `Stop watching ${term}`,
            onClick: () =>
              this.store.setPrefs({
                watchlist: prefs.watchlist.filter((item) => item !== term),
              }),
          }),
        ),
      ),
    );
  }

  _searchFor(term) {
    this.search = term;
    $('desk-search').value = term;
    this.renderFeed();
  }

  renderFeed() {
    const { news, newsError, loading } = this.store.state;
    const prefs = this.store.getPrefs();
    $('desk-refresh').textContent = loading ? 'READING…' : 'REFRESH';
    const list = $('desk-stories');
    const lead = $('desk-lead');
    const status = (title, text) => {
      lead.hidden = true;
      list.replaceChildren(
        el(
          'li',
          { class: 'desk-empty' },
          el('strong', { text: title }),
          el('span', { text }),
        ),
      );
      $('desk-feed-count').textContent = '';
    };
    if (!news)
      return newsError
        ? status(
            'The desk could not be read',
            `${newsError}. It tries again every minute.`,
          )
        : status(
            'Reading 35 newsrooms',
            'The first read can take up to half a minute on a slow connection.',
          );
    const rows = selectStories(news.stories, prefs, { search: this.search });
    if (!rows.length)
      return status(
        'No story matches these controls',
        'Widen the window, lower the floor or switch a desk back on.',
      );
    const [top, ...rest] = rows;
    lead.hidden = false;
    this._renderLead(lead, top, prefs);
    list.replaceChildren(
      ...rest.slice(0, FEED_LIMIT).map((story) => this._storyRow(story, prefs)),
    );
    const updated = relativeTime(news.updatedAt);
    $('desk-feed-count').textContent =
      `${rows.length} stories · read ${updated === 'now' ? 'just now' : `${updated} ago`}${news.stale ? ' · STALE' : ''}`;
  }

  _meta(story) {
    return el(
      'div',
      { class: 'story-meta' },
      el('span', {
        class: 'story-cat',
        text: story.category.toUpperCase(),
      }),
      el('span', { text: story.source }),
      el('span', { text: relativeTime(story.publishedAt) }),
      story.outlets > 1 &&
        el('span', {
          class: 'story-outlets',
          text: `${story.outlets} OUTLETS`,
        }),
      story.place && el('span', { text: story.place.name.toUpperCase() }),
    );
  }

  _score(story) {
    return el(
      'span',
      {
        class: 'story-score',
        title: `Priority ${story.priority} of 100: subject, severity, recency and number of outlets`,
        style: { '--score': String(story.priority) },
      },
      el('b', { text: String(story.priority) }),
    );
  }

  _actions(story) {
    return el(
      'div',
      { class: 'story-actions' },
      story.place &&
        el('button', {
          type: 'button',
          text: 'SHOW ON GLOBE',
          onClick: (event) => {
            event.stopPropagation();
            this.setOpen(false);
            this.actions.flyToStory(story);
          },
        }),
      safeUrl(story.url) &&
        el('a', {
          href: safeUrl(story.url),
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'OPEN SOURCE',
          onClick: () => this.store.markRead(story.id),
        }),
    );
  }

  _renderLead(node, story, prefs) {
    node.dataset.category = story.category;
    node.dataset.level = story.level;
    const image = safeUrl(story.image);
    const body = el(
      'div',
      { class: 'lead-body' },
      el(
        'div',
        { class: 'lead-kicker' },
        el('span', { class: 'lead-tag', text: story.level.toUpperCase() }),
        this._meta(story),
      ),
      el('h2', { text: story.title }),
      story.summary && el('p', { text: story.summary }),
      story.sources.length > 1 &&
        el(
          'ul',
          { class: 'lead-sources' },
          story.sources
            .slice(0, 3)
            .map((item) =>
              el(
                'li',
                {},
                externalLink(item.url, `${item.name} · ${item.title}`),
              ),
            ),
        ),
      this._actions(story),
    );
    const watched = watchMatches(story, prefs.watchlist);
    if (watched.length)
      body.querySelector('.lead-kicker').append(
        el('span', {
          class: 'lead-watch',
          text: `WATCH ${watched.join(' · ')}`,
        }),
      );
    node.replaceChildren(
      ...(image
        ? [
            el('img', {
              class: 'lead-image',
              src: image,
              alt: '',
              loading: 'lazy',
              referrerpolicy: 'no-referrer',
              onError: (event) => event.target.remove(),
            }),
          ]
        : []),
      body,
      this._score(story),
    );
  }

  _storyRow(story, prefs) {
    const open = this.openStoryId === story.id;
    const watched = watchMatches(story, prefs.watchlist);
    const row = el(
      'li',
      {
        class: `story${open ? ' open' : ''}${prefs.read.includes(story.id) ? ' read' : ''}${watched.length ? ' watched' : ''}`,
        dataset: { category: story.category, level: story.level },
      },
      this._score(story),
      el(
        'div',
        { class: 'story-body' },
        el('button', {
          type: 'button',
          class: 'story-title',
          text: story.title,
          'aria-expanded': String(open),
          onClick: () => {
            this.openStoryId = open ? null : story.id;
            if (!open) this.store.markRead(story.id);
            this.renderFeed();
          },
        }),
        this._meta(story),
        open && story.summary && el('p', { text: story.summary }),
        open &&
          story.sources.length > 1 &&
          el(
            'ul',
            { class: 'lead-sources' },
            story.sources.map((item) =>
              el(
                'li',
                {},
                externalLink(item.url, `${item.name} · ${item.title}`),
              ),
            ),
          ),
        open && this._actions(story),
      ),
    );
    return row;
  }

  renderHotspots() {
    const prefs = this.store.getPrefs();
    const spots = (this.store.state.news?.hotspots || [])
      .filter(
        (spot) =>
          prefs.region === 'world' ||
          (prefs.region === 'africa' ? spot.africa : spot.eastAfrica),
      )
      .slice(0, 10);
    const top = spots[0]?.score || 1;
    $('desk-hotspots').replaceChildren(
      ...spots.map((spot) => {
        const lead = Object.entries(spot.categories).sort(
          (a, b) => b[1] - a[1],
        )[0][0];
        return el(
          'li',
          { dataset: { category: lead } },
          el(
            'button',
            {
              type: 'button',
              title: `${spot.topTitle} — show on the globe`,
              onClick: () => {
                this.setOpen(false);
                this.actions.flyToPlace(spot);
              },
            },
            el('span', { text: spot.name }),
            el(
              'span',
              { class: 'hot-bar', 'aria-hidden': 'true' },
              el('i', {
                style: { width: `${Math.round((spot.score / top) * 100)}%` },
              }),
            ),
            el('b', { text: String(spot.count) }),
          ),
        );
      }),
    );
  }

  renderTrends() {
    const arrows = { rising: '▲', cooling: '▼', steady: '•' };
    $('desk-trends').replaceChildren(
      ...(this.store.state.news?.trends || []).map((trend) =>
        el(
          'button',
          {
            type: 'button',
            class: `desk-chip trend-${trend.direction}`,
            title: `${trend.count} stories, ${trend.direction}. Search for this`,
            onClick: () => this._searchFor(trend.term),
          },
          el('i', { text: arrows[trend.direction], 'aria-hidden': 'true' }),
          trend.term,
          el('b', { text: String(trend.count) }),
        ),
      ),
    );
  }

  renderAgenda() {
    this._radioChips(
      $('desk-agenda-kinds'),
      AGENDA_KINDS,
      this.agendaKind,
      (kind) => {
        this.agendaKind = kind;
        this.renderAgenda();
      },
    );
    const { calendar, calendarError } = this.store.state;
    const now = Date.now();
    const list = $('desk-agenda');
    if (!calendar)
      return list.replaceChildren(
        el('li', {
          class: 'desk-empty',
          text: calendarError || 'Reading the calendars',
        }),
      );
    const region = this.store.getPrefs().region;
    const events = calendar.events
      .filter((event) => event.at > now - 2 * 3_600_000)
      .filter(
        (event) => this.agendaKind === 'all' || event.kind === this.agendaKind,
      )
      .filter(
        (event) =>
          region === 'world' ||
          (region === 'africa' ? event.place?.africa : event.place?.eastAfrica),
      )
      // With every kind shown, minor items would bury the ones that matter.
      .filter(
        (event) =>
          this.agendaKind !== 'all' || event.weight >= 2 || event.place?.africa,
      )
      .sort(
        (a, b) =>
          Number(Boolean(a.approximate)) - Number(Boolean(b.approximate)) ||
          a.at - b.at,
      )
      .slice(0, 14);
    if (!events.length)
      return list.replaceChildren(
        el('li', { class: 'desk-empty', text: 'Nothing scheduled here yet' }),
      );
    list.replaceChildren(
      ...events.map((event) =>
        el(
          'li',
          { dataset: { kind: event.kind } },
          el('time', {
            text: countdown(event, now),
            title: event.approximate
              ? 'Exact date not set'
              : new Date(event.at).toLocaleString(
                  'en-GB',
                  event.allDay
                    ? { dateStyle: 'full', timeZone: 'UTC' }
                    : { dateStyle: 'full', timeStyle: 'short' },
                ),
          }),
          el(
            'div',
            {},
            externalLink(event.url, event.title),
            el('small', {
              text: [event.detail, event.source].filter(Boolean).join(' · '),
            }),
          ),
        ),
      ),
    );
  }

  renderMarkets() {
    const { markets, marketsError } = this.store.state;
    const box = $('desk-markets');
    if (!markets)
      return box.replaceChildren(
        el('span', {
          class: 'desk-empty',
          text: marketsError || 'Reading the markets',
        }),
      );
    const number = (value) =>
      value >= 1000
        ? value.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    box.replaceChildren(
      ...markets.rows.map((row) =>
        el(
          'div',
          { class: 'market' },
          el('span', { text: row.label }),
          el('b', { text: number(row.value) }),
          Number.isFinite(row.change) &&
            el('i', {
              class: row.change >= 0 ? 'up' : 'down',
              text: `${row.change >= 0 ? '+' : ''}${row.change.toFixed(2)}%`,
            }),
        ),
      ),
    );
  }

  _stopTv() {
    this.tvChannel = null;
    this.renderTv();
  }

  renderTv() {
    const channels = this.store.state.news?.channels || [];
    const box = $('desk-tv');
    if (
      this.tvChannel &&
      box.dataset.channel === this.tvChannel &&
      box.querySelector('iframe')
    )
      return;
    box.dataset.channel = this.tvChannel || '';
    const active = channels.find(({ id }) => id === this.tvChannel);
    const nodes = [];
    if (active && /^UC[\w-]{22}$/.test(active.channel))
      nodes.push(
        el('iframe', {
          src: `https://www.youtube-nocookie.com/embed/live_stream?channel=${active.channel}&autoplay=1&mute=1`,
          title: `${active.name} live`,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          referrerpolicy: 'strict-origin-when-cross-origin',
          loading: 'lazy',
        }),
      );
    nodes.push(
      el(
        'div',
        { class: 'desk-chips' },
        channels.map((channel) =>
          el('button', {
            type: 'button',
            class: `desk-chip${channel.id === this.tvChannel ? ' active' : ''}`,
            'aria-pressed': String(channel.id === this.tvChannel),
            text: channel.name,
            onClick: () => {
              this.tvChannel =
                channel.id === this.tvChannel ? null : channel.id;
              this.renderTv();
            },
          }),
        ),
      ),
    );
    box.replaceChildren(...nodes);
  }

  renderSources() {
    const sources = this.store.state.news?.sources || [];
    const prefs = this.store.getPrefs();
    const live = sources.filter(({ status }) => status === 'live').length;
    $('desk-source-count').textContent = sources.length
      ? `${live}/${sources.length} live`
      : '';
    const labels = {
      live: 'LIVE',
      stale: 'STALE',
      down: 'DOWN',
      'key-required': 'KEY',
    };
    $('desk-sources').replaceChildren(
      ...sources.map((source) => {
        const muted = prefs.mutedSources.includes(source.name);
        return el(
          'button',
          {
            type: 'button',
            class: `source${muted ? ' muted' : ''}`,
            'aria-pressed': String(!muted),
            dataset: { status: source.status },
            title:
              source.status === 'key-required'
                ? 'Add X_BEARER_TOKEN in POWER UP to read newsroom accounts on X'
                : `${source.via} · trust ${source.trust}/5${source.error ? ` · ${source.error}` : ''}. Click to ${muted ? 'unmute' : 'mute'}`,
            onClick: () =>
              this.store.setPrefs({
                mutedSources: muted
                  ? prefs.mutedSources.filter((name) => name !== source.name)
                  : [...prefs.mutedSources, source.name],
              }),
          },
          el('i', { 'aria-hidden': 'true' }),
          el('span', { text: source.name }),
          el('b', {
            text: muted
              ? 'MUTED'
              : source.status === 'live'
                ? String(source.count)
                : labels[source.status],
          }),
        );
      }),
    );
  }

  renderPulse() {
    const pulse = pulseOf(this._stories());
    const box = $('world-pulse');
    box.dataset.level = pulse.level;
    $('world-pulse-value').textContent =
      pulse.value === null ? '--' : String(pulse.value);
    box
      .querySelectorAll('.pulse-bars i')
      .forEach((bar, index) => bar.classList.toggle('on', index < pulse.bars));
  }

  renderUnread() {
    const prefs = this.store.getPrefs();
    const count = selectStories(this._stories(), {
      ...prefs,
      floor: Math.max(66, prefs.floor),
      hideRead: true,
    }).length;
    const badge = $('desk-unread');
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.title = `${count} unread high-priority stories`;
  }

  renderWire() {
    const prefs = this.store.getPrefs();
    const stories = selectStories(this._stories(), {
      ...prefs,
      sort: 'priority',
      hideRead: false,
      corroborated: false,
    }).slice(0, WIRE_LIMIT);
    const key = stories.map(({ id }) => id).join('|');
    const track = $('live-wire-track');
    if (track.dataset.key === key) return;
    track.dataset.key = key;
    if (!stories.length) {
      track.replaceChildren(
        el('span', {
          class: 'wire-item',
          text: this.store.state.newsError || 'Reading the world’s newsrooms',
        }),
      );
      return;
    }
    const item = (story, hiddenCopy) =>
      el(
        'button',
        {
          type: 'button',
          class: 'wire-item',
          dataset: { category: story.category, level: story.level },
          tabindex: hiddenCopy ? '-1' : undefined,
          'aria-hidden': hiddenCopy ? 'true' : undefined,
          onClick: () => this.actions.showStory(story),
        },
        el('i', { 'aria-hidden': 'true' }),
        el('b', { text: story.place?.name?.toUpperCase() || story.source }),
        story.title,
      );
    // A second, hidden copy lets the strip loop without a visible jump.
    track.replaceChildren(
      el(
        'div',
        {
          class: 'wire-loop',
          style: { '--wire-seconds': `${stories.length * 9}s` },
        },
        stories.map((story) => item(story, false)),
        stories.map((story) => item(story, true)),
      ),
    );
  }

  showAlert(story) {
    const stack = $('desk-alerts-stack');
    const card = el(
      'div',
      {
        class: 'desk-alert bento',
        dataset: { category: story.category, level: story.level },
      },
      el('span', { class: 'lead-tag', text: story.level.toUpperCase() }),
      el('button', {
        type: 'button',
        class: 'desk-alert-title',
        text: story.title,
        onClick: () => {
          card.remove();
          this.actions.showStory(story);
        },
      }),
      el('button', {
        type: 'button',
        class: 'desk-alert-close',
        text: '×',
        'aria-label': 'Dismiss alert',
        onClick: () => card.remove(),
      }),
    );
    stack.append(card);
    while (stack.children.length > 4) stack.firstChild.remove();
    setTimeout(() => card.remove(), 20_000);
  }

  destroy() {
    clearInterval(this.clock);
    this.unsubscribe();
    this.listeners.abort();
    this._stopTv();
    document.body.classList.remove('desk-open');
  }
}
