import { el, externalLink, safeUrl } from './dom.js';
import { relativeTime } from './deskModel.js';

/** The details of one map record or story, shown over the globe. */
export class IntelCard {
  constructor({ root, onFly, onOpenDesk, onRead }) {
    this.root = root;
    this.actions = { onFly, onOpenDesk, onRead };
  }

  hide() {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  _frame(kicker, title, color, nodes) {
    this.root.style.setProperty('--card-accent', color || '#35d6ff');
    this.root.replaceChildren(
      el(
        'header',
        { class: 'intel-card-head' },
        el('span', { text: kicker }),
        el('button', {
          type: 'button',
          text: '×',
          'aria-label': 'Close details',
          onClick: () => this.hide(),
        }),
      ),
      el('h3', { text: title }),
      ...nodes.filter(Boolean),
    );
    this.root.hidden = false;
  }

  showRecord({ layerName, item, kind }) {
    this._frame(layerName.toUpperCase(), item.title, kind?.color, [
      item.details?.length &&
        el(
          'dl',
          {},
          item.details.flatMap(([name, value]) => [
            el('dt', { text: name }),
            el('dd', { text: String(value) }),
          ]),
        ),
      item.summary && el('p', { text: item.summary }),
      item.stories?.length &&
        el(
          'ol',
          { class: 'intel-card-stories' },
          item.stories.map((story) =>
            el(
              'li',
              { dataset: { category: story.category } },
              el('button', {
                type: 'button',
                text: story.title,
                onClick: () => this.showStory(story),
              }),
              el('small', {
                text: `${story.source} · ${relativeTime(story.publishedAt)} · P${story.priority}`,
              }),
            ),
          ),
        ),
      el(
        'footer',
        {},
        el('span', {
          text: [item.source, `${item.lat.toFixed(3)}, ${item.lon.toFixed(3)}`]
            .filter(Boolean)
            .join(' · '),
        }),
        item.at && el('span', { text: `${relativeTime(item.at)} ago` }),
      ),
      el(
        'div',
        { class: 'story-actions' },
        el('button', {
          type: 'button',
          text: 'FLY HERE',
          onClick: () => this.actions.onFly(item),
        }),
        safeUrl(item.url) && externalLink(item.url, 'OPEN SOURCE'),
      ),
    ]);
  }

  showStory(story) {
    this.actions.onRead(story.id);
    this._frame(
      `${story.category.toUpperCase()} · ${story.level.toUpperCase()} · P${story.priority}`,
      story.title,
      `var(--cat-${story.category}, #35d6ff)`,
      [
        story.summary && el('p', { text: story.summary }),
        el(
          'ul',
          { class: 'lead-sources' },
          story.sources
            .slice(0, 6)
            .map((source) =>
              el(
                'li',
                {},
                externalLink(
                  source.url,
                  `${source.name} · ${relativeTime(source.publishedAt)}`,
                ),
              ),
            ),
        ),
        el(
          'div',
          { class: 'story-actions' },
          story.place &&
            el('button', {
              type: 'button',
              text: 'FLY HERE',
              onClick: () => this.actions.onFly(story.place),
            }),
          el('button', {
            type: 'button',
            text: 'WORLD DESK',
            onClick: () => this.actions.onOpenDesk(),
          }),
          safeUrl(story.url) && externalLink(story.url, 'OPEN SOURCE'),
        ),
      ],
    );
  }
}
