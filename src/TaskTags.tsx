import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  Check,
  ChevronDown,
  Hash,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { TagGroup, TagRecord } from "./model";
import {
  findTagByName,
  normalizeTagName,
  TAG_GROUPS,
  tagNameKey,
} from "./tags";
import { noTextSuggestions } from "./editor-preferences";
import "./task-tags.css";

export const TAG_COLORS = [
  "#24704f",
  "#8a4caa",
  "#26826b",
  "#ad721f",
  "#bf514a",
  "#627087",
];
export type TagDraft = { name: string; group: TagGroup; color: string };
const tagStyle = (tag: TagRecord): CSSProperties =>
  ({
    "--tag-color": /^#[\da-f]{6}$/i.test(tag.color) ? tag.color : TAG_COLORS[0],
  }) as CSSProperties;

export function TagChips({
  tags,
  onRemove,
  compact = false,
}: {
  tags: TagRecord[];
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  if (!tags.length) return null;
  return (
    <span className={`tag-chips ${compact ? "is-compact" : ""}`}>
      {tags.map((tag) => (
        <span className="tag-chip" key={tag.id} style={tagStyle(tag)}>
          <Hash size={compact ? 10 : 11} aria-hidden="true" />
          <span>{tag.name}</span>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              title={`Remove ${tag.name}`}
              onClick={() => onRemove(tag.id)}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

export default function TaskTags({
  tags,
  tagIds,
  onChange,
  onCreate,
}: {
  tags: TagRecord[];
  tagIds: string[];
  onChange: (ids: string[]) => void;
  onCreate: (draft: TagDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<TagGroup>("topic");
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const popoverId = useId();
  const label = normalizeTagName(query);
  const active = tags.filter((tag) => !tag.deletedAt);
  const matching = active.filter((tag) =>
    tagNameKey(tag.name).includes(tagNameKey(label)),
  );
  const exact = findTagByName(active, label);
  const selected = active.filter((tag) => tagIds.includes(tag.id));
  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const toggle = (id: string) =>
    onChange(
      tagIds.includes(id)
        ? tagIds.filter((value) => value !== id)
        : [...new Set([...tagIds, id])],
    );
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!label) return;
    if (exact) {
      if (!tagIds.includes(exact.id)) toggle(exact.id);
    } else
      onCreate({
        name: label,
        group,
        color: TAG_COLORS[TAG_GROUPS.findIndex((value) => value.id === group)],
      });
    setQuery("");
    search.current?.focus();
  };
  return (
    <div
      className="task-tags-field"
      ref={anchor}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <span className="task-tags-label">Tags</span>
      <div className="task-tags-values">
        <TagChips
          tags={selected}
          onRemove={(id) => onChange(tagIds.filter((value) => value !== id))}
        />
        <button
          ref={trigger}
          type="button"
          className={`tag-add ${open ? "active" : ""}`}
          aria-label="Add tag"
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Plus size={12} />
          Add tag
        </button>
      </div>
      {open && (
        <section
          id={popoverId}
          className="tag-popover"
          role="dialog"
          aria-label="Choose task tags"
        >
          <form
            onSubmit={create}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing)
                event.preventDefault();
            }}
          >
            <div className="tag-search">
              <Search size={14} />
              <input
                {...noTextSuggestions}
                ref={search}
                aria-label="Find or create tag"
                placeholder="Find or create a tag…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="tag-close"
                aria-label="Close tags"
                onClick={() => close(true)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="tag-options">
              {TAG_GROUPS.map((category) => {
                const choices = matching.filter(
                  (tag) => (tag.group ?? "topic") === category.id,
                );
                return choices.length ? (
                  <div className="tag-option-group" key={category.id}>
                    <span>{category.name}</span>
                    {choices.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className="tag-option"
                        role="checkbox"
                        aria-checked={tagIds.includes(tag.id)}
                        onClick={() => toggle(tag.id)}
                        style={tagStyle(tag)}
                      >
                        <Hash size={13} />
                        <span>{tag.name}</span>
                        <span className="tag-option-check">
                          {tagIds.includes(tag.id) && <Check size={12} />}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null;
              })}
              {!matching.length && (
                <p className="tag-empty">
                  {label
                    ? "No matching tags."
                    : "Create a tag to connect tasks across lists."}
                </p>
              )}
            </div>
            {label && !exact && (
              <div className="tag-create">
                <label>
                  Group
                  <select
                    aria-label="New tag group"
                    value={group}
                    onChange={(event) =>
                      setGroup(event.target.value as TagGroup)
                    }
                  >
                    {TAG_GROUPS.map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" title={`Create tag ${label}`}>
                  <Plus size={13} />
                  <span>Create “{label}”</span>
                </button>
              </div>
            )}
          </form>
        </section>
      )}
    </div>
  );
}

export function TagSidebar({
  tags,
  counts,
  selectedId,
  onSelect,
  onCreate,
}: {
  tags: TagRecord[];
  counts: Map<string, number>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const active = tags.filter((tag) => !tag.deletedAt);
  return (
    <section className="sidebar-tags" aria-label="Tags">
      <div className="sidebar-section">
        <span>TAGS</span>
        <button
          type="button"
          className="icon-button"
          aria-label="New tag"
          title="New tag"
          onClick={onCreate}
        >
          <Plus size={15} />
        </button>
      </div>
      {!active.length && (
        <button type="button" className="tag-sidebar-empty" onClick={onCreate}>
          Add tags to connect your tasks.
        </button>
      )}
      {TAG_GROUPS.map((category) => {
        const children = active.filter(
          (tag) => (tag.group ?? "topic") === category.id,
        );
        return children.length ? (
          <details className="tag-sidebar-group" open key={category.id}>
            <summary>
              <ChevronDown size={12} />
              <span>{category.name}</span>
            </summary>
            <nav aria-label={`${category.name} tags`}>
              {children.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  className={`nav-item tag-nav ${selectedId === tag.id ? "active" : ""}`}
                  onClick={() => onSelect(tag.id)}
                  style={tagStyle(tag)}
                >
                  <Hash size={14} />
                  <span className="tag-nav-name">{tag.name}</span>
                  <span className="count">{counts.get(tag.id) || ""}</span>
                </button>
              ))}
            </nav>
          </details>
        ) : null;
      })}
    </section>
  );
}

export function TagDialog({
  tag,
  tags,
  onSave,
  onDelete,
  onClose,
}: {
  tag: TagRecord | null;
  tags: TagRecord[];
  onSave: (draft: TagDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tag?.name ?? "");
  const [group, setGroup] = useState<TagGroup>(tag?.group ?? "topic");
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[0]);
  const normalized = normalizeTagName(name);
  const duplicate = !!findTagByName(
    tags.filter((value) => value.id !== tag?.id),
    normalized,
  );
  const heading = useId();
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        ref={form}
        className="modal small-modal tag-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={heading}
        onSubmit={(event) => {
          event.preventDefault();
          if (normalized && !duplicate)
            onSave({ name: normalized, group, color });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) {
            if (event.key === "Enter") event.preventDefault();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const focusable = [
              ...(form.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), input, select",
              ) ?? []),
            ];
            const first = focusable[0],
              last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2 id={heading}>{tag ? "Edit tag" : "New tag"}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close tag editor"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <label className="tag-dialog-label">
          Name
          <input
            {...noTextSuggestions}
            ref={input}
            aria-label="Tag name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Reading"
            aria-invalid={duplicate}
          />
        </label>
        {duplicate && (
          <p className="tag-dialog-error" role="alert">
            A tag with this name already exists.
          </p>
        )}
        <label className="tag-dialog-label">
          Group
          <select
            aria-label="Tag group"
            value={group}
            onChange={(event) => setGroup(event.target.value as TagGroup)}
          >
            {TAG_GROUPS.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="tag-color-field">
          <legend>Color</legend>
          <div className="tag-colors">
            {TAG_COLORS.map((value) => (
              <button
                type="button"
                key={value}
                aria-label={`Tag color ${value}`}
                aria-pressed={color === value}
                style={{ background: value }}
                onClick={() => setColor(value)}
              >
                {color === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </fieldset>
        <footer>
          {tag && onDelete && (
            <button type="button" className="tag-delete" onClick={onDelete}>
              <Trash2 size={14} />
              Delete tag
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={!normalized || duplicate}
          >
            {tag ? "Save" : "Create tag"}
          </button>
        </footer>
      </form>
    </div>
  );
}
