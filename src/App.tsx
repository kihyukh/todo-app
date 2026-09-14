import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sun,
  Inbox,
  CalendarDays,
  Layers,
  CheckCheck,
  Check,
  Plus,
  Search,
  Settings2,
  Cloud,
  HardDrive,
  PanelLeftClose,
  PanelLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  MoreHorizontal,
  LayoutList,
  Columns3,
  Flag,
  X,
  Trash2,
  RotateCcw,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  ExternalLink,
  Circle,
  ArrowUpRight,
  Keyboard,
  CheckSquare2,
  FolderOpen,
  Hash,
} from "lucide-react";
import TaskEditor from "./TaskEditor";
import TaskTags, { TagChips, TagDialog, TagSidebar } from "./TaskTags";
import type { TagDraft } from "./TaskTags";
import {
  activeTags,
  assignTag,
  findTagByName,
  normalizeTagName,
  TAG_GROUPS,
  tagCounts,
  taskTags,
} from "./tags";
import { extractCheckboxes, toggleCheckbox, plainText } from "./editor-utils";
import {
  activeTasks,
  addDays,
  dateKey,
  dateLabel,
  emptyDoc,
  now,
  uid,
} from "./model";
import type { Attachment, Task, TagRecord } from "./model";
import { isNative, nativeSend, useWorkspace } from "./storage";
import {
  noTextSuggestions,
  readVimPreference,
  writeVimPreference,
} from "./editor-preferences";

type View =
  | "today"
  | "upcoming"
  | "all"
  | "inbox"
  | "checkboxes"
  | "completed"
  | "trash"
  | `project:${string}`
  | `tag:${string}`;
type Dialog = { kind: "project" | "column"; id?: string; value: string } | null;
const palette = [
  "#547ce8",
  "#bc82b5",
  "#4c9f88",
  "#c89a4d",
  "#e18478",
  "#8695a8",
];
function IconButton({
  label,
  children,
  onClick,
  active = false,
  ...rest
}: any) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
function App() {
  const {
    state,
    setState,
    ready,
    error,
    setError,
    storage,
    saving,
    attachNative,
  } = useWorkspace();
  const [view, setView] = useState<View>("today");
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    window.innerWidth > 920 ? "example-review" : null,
  );
  const [mode, setMode] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [vimEnabled, setVimEnabled] = useState(readVimPreference);
  const [notePending, setNotePending] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tagDialog, setTagDialog] = useState<{ id?: string } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [plan, setPlan] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(
    null,
  );
  const [today, setToday] = useState(dateKey());
  const [toast, setToast] = useState("");
  const quickRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const active = activeTasks(state);
  const tags = activeTags(state);
  const countsByTag = tagCounts(state);
  const selectedTag = view.startsWith("tag:")
    ? tags.find((tag) => tag.id === view.slice(4))
    : undefined;
  const projects = state.projects.filter((p) => !p.deletedAt),
    columns = state.columns
      .filter((c) => !c.deletedAt)
      .sort(
        (a, b) =>
          (a.order ??
            (["next", "progress", "waiting"].indexOf(a.id) + 1) * 10) -
          (b.order ?? (["next", "progress", "waiting"].indexOf(b.id) + 1) * 10),
      );
  const selected = state.tasks.find((t) => t.id === selectedId && !t.deletedAt);
  const openItems = useMemo(
    () =>
      state.tasks
        .filter((t) => !t.deletedAt)
        .flatMap((task) =>
          extractCheckboxes(task.notes)
            .filter((c) => !c.checked)
            .map((check) => ({ task, ...check })),
        ),
    [state.tasks],
  );
  const title = view.startsWith("tag:")
    ? (selectedTag?.name ?? "Tag")
    : view.startsWith("project:")
      ? (projects.find((p) => p.id === view.slice(8))?.name ?? "List")
      : (
          {
            today: "Today",
            upcoming: "Upcoming",
            all: "All tasks",
            inbox: "Inbox",
            checkboxes: "Open checkboxes",
            completed: "Completed",
            trash: "Trash",
          } as Record<string, string>
        )[view];
  const visible = state.tasks.filter((t) => {
    if (view === "trash") {
      if (!t.deletedAt) return false;
    } else if (t.deletedAt) return false;
    if (view === "completed") {
      if (!t.completedAt) return false;
    } else if (view !== "trash" && t.completedAt) return false;
    if (view === "today" && t.doDate !== today) return false;
    if (
      view === "upcoming" &&
      !((t.doDate && t.doDate > today) || (t.deadline && t.deadline >= today))
    )
      return false;
    if (view === "inbox" && t.projectId) return false;
    if (view.startsWith("project:") && t.projectId !== view.slice(8))
      return false;
    if (view.startsWith("tag:") && !(t.tagIds ?? []).includes(view.slice(4)))
      return false;
    return (
      !query ||
      `${t.title} ${plainText(t.notes)} ${taskTags(t, state)
        .map((tag) => tag.name)
        .join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  });
  const sorted = [...visible].sort((a, b) =>
    view === "upcoming"
      ? (a.doDate && a.doDate >= today
          ? a.doDate
          : (a.deadline ?? "9999")
        ).localeCompare(
          b.doDate && b.doDate >= today ? b.doDate : (b.deadline ?? "9999"),
        )
      : a.createdAt.localeCompare(b.createdAt),
  );
  const earlier = active.filter((t) => t.doDate && t.doDate < today);
  const todayCount = active.filter((t) => t.doDate === today).length;
  const completedToday = state.tasks.filter(
    (t) =>
      !t.deletedAt &&
      t.completedAt &&
      dateKey(new Date(t.completedAt)) === today,
  ).length;
  useEffect(() => {
    writeVimPreference(vimEnabled);
  }, [vimEnabled]);
  useEffect(() => {
    const timer = setInterval(() => setToday(dateKey()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        add();
      }
      if (e.key === "Escape") {
        setSettings(false);
        setDialog(null);
        setTagDialog(null);
        setMenu(false);
        setPlan(false);
        setAttachmentPreview(null);
      }
    }
    const add = () => {
      if (window.innerWidth <= 920) setSelectedId(null);
      if (["checkboxes", "completed", "trash"].includes(view)) setView("today");
      requestAnimationFrame(() => quickRef.current?.focus());
    };
    window.addEventListener("keydown", key);
    window.addEventListener("daymark-new-task", add);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("daymark-new-task", add);
    };
  }, [view]);
  function changeView(v: View) {
    if (window.innerWidth <= 920) setSelectedId(null);
    setView(v);
    setQuery("");
    setSidebar(false);
    setPlan(false);
  }
  function updateTask(id: string, patch: Partial<Task>) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              updatedAt: new Date(
                Math.max(Date.now(), Date.parse(t.updatedAt) + 1),
              ).toISOString(),
            }
          : t,
      ),
    }));
  }
  function createTag(draft: TagDraft, taskId?: string) {
    const name = normalizeTagName(draft.name);
    if (!name) return;
    const candidate: TagRecord = {
      id: uid(),
      name,
      group: draft.group,
      color: draft.color,
      updatedAt: now(),
    };
    setState((s) => {
      const existing = findTagByName(s.tags ?? [], name);
      const tag = existing ?? candidate;
      return {
        ...s,
        tags: existing ? s.tags : [...(s.tags ?? []), tag],
        tasks: taskId
          ? s.tasks.map((task) =>
              task.id === taskId
                ? assignTag(
                    task,
                    tag.id,
                    new Date(
                      Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
                    ).toISOString(),
                  )
                : task,
            )
          : s.tasks,
      };
    });
  }
  function saveTag(draft: TagDraft) {
    if (tagDialog?.id) {
      const id = tagDialog.id;
      setState((s) => ({
        ...s,
        tags: (s.tags ?? []).map((tag) =>
          tag.id === id
            ? {
                ...tag,
                ...draft,
                name: normalizeTagName(draft.name),
                updatedAt: new Date(
                  Math.max(Date.now(), Date.parse(tag.updatedAt) + 1),
                ).toISOString(),
              }
            : tag,
        ),
      }));
    } else createTag(draft);
    setTagDialog(null);
  }
  function deleteTag(id: string) {
    setState((s) => ({
      ...s,
      tags: (s.tags ?? []).map((tag) =>
        tag.id === id
          ? {
              ...tag,
              deletedAt: now(),
              updatedAt: new Date(
                Math.max(Date.now(), Date.parse(tag.updatedAt) + 1),
              ).toISOString(),
            }
          : tag,
      ),
      tasks: s.tasks.map((task) =>
        (task.tagIds ?? []).includes(id)
          ? {
              ...task,
              tagIds: task.tagIds!.filter((value) => value !== id),
              updatedAt: new Date(
                Math.max(Date.now(), Date.parse(task.updatedAt) + 1),
              ).toISOString(),
            }
          : task,
      ),
    }));
    if (view === `tag:${id}`) changeView("all");
    setTagDialog(null);
    setToast("Tag deleted");
  }
  function complete(task: Task) {
    updateTask(task.id, { completedAt: task.completedAt ? null : now() });
  }
  function addTask(event?: React.FormEvent, columnId?: string) {
    event?.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      quickRef.current?.focus();
      return;
    }
    const stamp = now();
    const task: Task = {
      id: uid(),
      title,
      notes: emptyDoc(),
      projectId: view.startsWith("project:") ? view.slice(8) : "",
      tagIds: selectedTag ? [selectedTag.id] : [],
      columnId: columnId ?? columns[0]?.id ?? "next",
      doDate: view === "today" ? today : null,
      deadline: null,
      completedAt: null,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      attachments: [],
    };
    setState((s) => ({ ...s, tasks: [...s.tasks, task] }));
    setNewTitle("");
    setSelectedId(task.id);
    if (["completed", "trash", "checkboxes", "upcoming"].includes(view))
      changeView("inbox");
  }
  function attachToTask(taskId: string, attachment: Attachment) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              attachments: [...t.attachments, attachment],
              updatedAt: now(),
            }
          : t,
      ),
    }));
  }
  function attach() {
    if (!selected) return;
    const taskId = selected.id;
    if (isNative()) attachNative((a) => attachToTask(taskId, a));
    else fileRef.current?.click();
  }
  async function attachFiles(files: FileList | null) {
    if (!files || !selected) return;
    const taskId = selected.id;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        setError("Choose an image or a PDF.");
        continue;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError("Please choose a file smaller than 25 MB.");
        continue;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      attachToTask(taskId, {
        id: uid(),
        name: file.name,
        mime: file.type,
        size: file.size,
        url,
      });
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  function exportData() {
    if (isNative()) {
      nativeSend({ action: "export", state });
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    link.download = `Daymark-${today}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function saveDialog(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog?.value.trim()) return;
    const name = dialog.value.trim();
    setState((s) => {
      const field = dialog.kind === "project" ? "projects" : "columns";
      return {
        ...s,
        [field]: dialog.id
          ? s[field].map((v) =>
              v.id === dialog.id ? { ...v, name, updatedAt: now() } : v,
            )
          : [
              ...s[field],
              {
                id: uid(),
                name,
                color: palette[s[field].length % palette.length],
                order:
                  Math.max(
                    0,
                    ...s[field].map((v, i) => v.order ?? (i + 1) * 10),
                  ) + 10,
                updatedAt: now(),
              },
            ],
      };
    });
    setDialog(null);
  }
  function moveColumn(id: string, direction: number) {
    const reordered = [...columns];
    const index = reordered.findIndex((c) => c.id === id),
      target = index + direction;
    if (target < 0 || target >= reordered.length) return;
    [reordered[index], reordered[target]] = [
      reordered[target],
      reordered[index],
    ];
    setState((s) => ({
      ...s,
      columns: s.columns.map((c) => {
        const order = reordered.findIndex((r) => r.id === c.id);
        return order < 0 ? c : { ...c, order: order * 10, updatedAt: now() };
      }),
    }));
  }
  function removeColumn(id: string) {
    const target = columns.find((c) => c.id !== id);
    if (!target) return;
    setState((s) => ({
      ...s,
      columns: s.columns.map((c) =>
        c.id === id ? { ...c, deletedAt: now(), updatedAt: now() } : c,
      ),
      tasks: s.tasks.map((t) =>
        t.columnId === id ? { ...t, columnId: target.id, updatedAt: now() } : t,
      ),
    }));
  }
  function taskRow(task: Task, compact = false) {
    const checks = extractCheckboxes(task.notes),
      done = checks.filter((c) => c.checked).length;
    const project = projects.find((p) => p.id === task.projectId);
    return (
      <div
        key={task.id}
        className={`task-row ${selectedId === task.id ? "selected" : ""} ${compact ? "compact" : ""}`}
        draggable={!task.deletedAt}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", task.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <button
          className={`task-check ${task.completedAt ? "checked" : ""}`}
          aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${task.title}`}
          onClick={() => complete(task)}
        >
          {task.completedAt && <Check size={12} />}
        </button>
        <button className="task-content" onClick={() => setSelectedId(task.id)}>
          <span className={`task-title ${task.completedAt ? "done" : ""}`}>
            {task.title}
          </span>
          <span className="task-metadata">
            {project && (
              <span>
                <i style={{ background: project.color }} />
                {project.name}
              </span>
            )}
            {checks.length > 0 && (
              <span>
                <CheckSquare2 size={12} />
                {done}/{checks.length}
              </span>
            )}
            {task.attachments.length > 0 && (
              <span>
                <Paperclip size={12} />
                {task.attachments.length}
              </span>
            )}
            {task.deadline && (
              <span
                className={`deadline ${task.deadline < today ? "overdue" : ""}`}
              >
                <Flag size={12} />
                Due {dateLabel(task.deadline)}
              </span>
            )}
          </span>
          <TagChips tags={taskTags(task, state)} compact />
        </button>
        {task.deletedAt ? (
          <IconButton
            label="Restore task"
            onClick={() => updateTask(task.id, { deletedAt: null })}
          >
            <RotateCcw size={16} />
          </IconButton>
        ) : (
          view !== "today" &&
          task.doDate && (
            <span className="row-do-date">
              <Sun size={12} />
              {dateLabel(task.doDate)}
            </span>
          )
        )}
        {!task.deletedAt && (
          <button
            className={`plan-task ${task.doDate === today ? "planned" : ""}`}
            title={task.doDate === today ? "Remove from Today" : "Do today"}
            aria-label={`${task.doDate === today ? "Remove from Today" : "Do today"}: ${task.title}`}
            onClick={() =>
              updateTask(task.id, {
                doDate: task.doDate === today ? null : today,
              })
            }
          >
            <Sun size={15} />
          </button>
        )}
      </div>
    );
  }
  const navigation = [
    { id: "today", label: "Today", icon: Sun, count: todayCount },
    { id: "upcoming", label: "Upcoming", icon: CalendarDays, count: null },
    { id: "all", label: "All tasks", icon: Layers, count: active.length },
    {
      id: "inbox",
      label: "Inbox",
      icon: Inbox,
      count: active.filter((t) => !t.projectId).length,
    },
    {
      id: "checkboxes",
      label: "Open checkboxes",
      icon: CheckSquare2,
      count: openItems.length,
    },
  ];
  if (!ready)
    return (
      <div className="loading">
        <span className="brand-mark">
          <Check size={23} />
        </span>
        <p>{error || "Opening Daymark…"}</p>
      </div>
    );
  return (
    <div
      className={`app-shell ${selected ? "has-detail" : ""} ${sidebar ? "sidebar-open" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Check size={20} strokeWidth={2.5} />
          </span>
          <span>Daymark</span>
          <IconButton label="Hide sidebar" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={17} />
          </IconButton>
        </div>
        <div className="search">
          <Search size={15} />
          <input
            {...noTextSuggestions}
            ref={searchRef}
            aria-label="Search tasks"
            placeholder={
              view === "completed"
                ? "Search completed tasks"
                : view === "trash"
                  ? "Search Trash"
                  : "Search tasks"
            }
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value && view !== "completed" && view !== "trash")
                setView("all");
            }}
          />
          <kbd>⌘ K</kbd>
        </div>
        <nav aria-label="Task views">
          {navigation.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              onClick={() => changeView(id as View)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {!!count && <span className="count">{count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-collections">
          <div className="sidebar-section">
            <span>MY LISTS</span>
            <IconButton
              label="Add list"
              onClick={() => setDialog({ kind: "project", value: "" })}
            >
              <Plus size={15} />
            </IconButton>
          </div>
          <nav aria-label="Lists">
            {projects.map((project) => (
              <button
                key={project.id}
                className={`nav-item project-nav ${view === `project:${project.id}` ? "active" : ""}`}
                onClick={() => changeView(`project:${project.id}`)}
                onDoubleClick={() =>
                  setDialog({
                    kind: "project",
                    id: project.id,
                    value: project.name,
                  })
                }
              >
                <i style={{ background: project.color }} />
                <span>{project.name}</span>
                <span className="count">
                  {active.filter((t) => t.projectId === project.id).length ||
                    ""}
                </span>
              </button>
            ))}
          </nav>
          <TagSidebar
            tags={tags}
            counts={countsByTag}
            selectedId={selectedTag?.id}
            onSelect={(id) => changeView(`tag:${id}`)}
            onCreate={() => setTagDialog({})}
          />
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "completed" ? "active" : ""}`}
            onClick={() => changeView("completed")}
          >
            <CheckCheck size={18} />
            <span>Completed</span>
          </button>
          <button
            className={`nav-item ${view === "trash" ? "active" : ""}`}
            onClick={() => {
              changeView("trash");
              setSelectedId(null);
            }}
          >
            <Trash2 size={17} />
            <span>Trash</span>
          </button>
          <div className="storage-footer">
            <button
              onClick={() => setSettings(true)}
              className="storage-status"
            >
              {storage.kind === "icloud" ? (
                <Cloud size={16} />
              ) : (
                <HardDrive size={16} />
              )}
              <span>
                {saving
                  ? "Saving…"
                  : storage.kind === "icloud"
                    ? "iCloud Drive"
                    : storage.kind === "folder"
                      ? "Shared folder"
                      : "On this device"}
              </span>
            </button>
            <IconButton label="Settings" onClick={() => setSettings(true)}>
              <Settings2 size={16} />
            </IconButton>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <main
        className={`workspace ${mode === "board" && view !== "checkboxes" ? "board-workspace" : ""}`}
      >
        <div className="workspace-top">
          <IconButton label="Show sidebar" onClick={() => setSidebar(true)}>
            <PanelLeft size={18} />
          </IconButton>
          <span>
            {view === "today"
              ? new Date(today + "T12:00:00").toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : "YOUR WORKSPACE"}
          </span>
          <div className="top-right">
            {view === "today" && (
              <span className="day-progress">
                {completedToday > 0
                  ? `${completedToday} completed`
                  : "A little focus goes a long way"}
              </span>
            )}
          </div>
        </div>
        <header className="workspace-header">
          <h1>{title}</h1>
          <div className="view-actions">
            {!["checkboxes", "trash", "completed"].includes(view) && (
              <div className="view-switch" role="group" aria-label="Layout">
                <IconButton
                  label="List view"
                  active={mode === "list"}
                  onClick={() => setMode("list")}
                >
                  <LayoutList size={17} />
                </IconButton>
                <IconButton
                  label="Board view"
                  active={mode === "board"}
                  onClick={() => setMode("board")}
                >
                  <Columns3 size={17} />
                </IconButton>
              </div>
            )}
            {selectedTag && (
              <IconButton
                label="Edit tag"
                onClick={() => setTagDialog({ id: selectedTag.id })}
              >
                <MoreHorizontal size={18} />
              </IconButton>
            )}
            {view.startsWith("project:") && (
              <IconButton
                label="Rename list"
                onClick={() =>
                  setDialog({
                    kind: "project",
                    id: view.slice(8),
                    value: title,
                  })
                }
              >
                <MoreHorizontal size={18} />
              </IconButton>
            )}
          </div>
        </header>
        {selectedTag && (
          <p className="tag-view-description">
            <Hash size={12} />
            <span>
              {
                TAG_GROUPS.find(
                  (group) => group.id === (selectedTag.group ?? "topic"),
                )?.name
              }{" "}
              · Across all lists
            </span>
          </p>
        )}
        {view === "today" && (
          <div className="today-intro">
            <span>
              {todayCount} {todayCount === 1 ? "task" : "tasks"} to focus on
            </span>
            <button
              onClick={() => setPlan(!plan)}
              className={`text-button ${plan ? "chosen" : ""}`}
            >
              <Plus size={14} />
              Plan your day
            </button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {plan && (
          <div className="planning-panel">
            <div className="section-title">
              CHOOSE SOMETHING TO WORK ON
              <button
                aria-label="Close day planner"
                onClick={() => setPlan(false)}
              >
                <X size={15} />
              </button>
            </div>
            <p>Adding to Today keeps its deadline unchanged.</p>
            {active.filter((t) => t.doDate !== today).length ? (
              active
                .filter((t) => t.doDate !== today)
                .map((t) => (
                  <button
                    key={t.id}
                    className="planning-row"
                    onClick={() => {
                      updateTask(t.id, { doDate: today });
                      setToast("Added to Today");
                    }}
                  >
                    <Plus size={16} />
                    <span>{t.title}</span>
                    {t.deadline && <small>Due {dateLabel(t.deadline)}</small>}
                  </button>
                ))
            ) : (
              <p>Everything is already on your list for today.</p>
            )}
          </div>
        )}
        {!["checkboxes", "completed", "trash"].includes(view) && (
          <form className="quick-add" onSubmit={(e) => addTask(e)}>
            <Plus size={18} />
            <input
              {...noTextSuggestions}
              ref={quickRef}
              aria-label="New task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={
                view === "today" ? "Add a task for today…" : "Add a task…"
              }
            />
            {newTitle ? (
              <button type="submit">
                Add <span>↵</span>
              </button>
            ) : (
              <kbd>⌘ N</kbd>
            )}
          </form>
        )}
        <div className="task-scroll">
          {view === "checkboxes" ? (
            <>
              <p className="view-description">
                The small steps, gathered from your task notes.
              </p>
              {openItems.length === 0 ? (
                <Empty
                  icon={CheckCheck}
                  title="All the small things, done"
                  body="Unchecked items in your task notes will appear here."
                />
              ) : (
                state.tasks
                  .filter(
                    (task) =>
                      !task.deletedAt &&
                      openItems.some((item) => item.task.id === task.id),
                  )
                  .map((task) => (
                    <section className="checkbox-group" key={task.id}>
                      <button
                        className="parent-task"
                        onClick={() => setSelectedId(task.id)}
                      >
                        <span>
                          {task.title}
                          {task.completedAt && (
                            <small className="completed-parent">
                              Completed task
                            </small>
                          )}
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                      {openItems
                        .filter((c) => c.task.id === task.id)
                        .map((c) => (
                          <div
                            className="open-check-row"
                            key={c.path.join(".")}
                          >
                            <button
                              className="task-check"
                              aria-label={`Check ${c.text}`}
                              onClick={() =>
                                updateTask(task.id, {
                                  notes: toggleCheckbox(
                                    task.notes,
                                    c.path,
                                    true,
                                  ),
                                })
                              }
                            />
                            <button onClick={() => setSelectedId(task.id)}>
                              {c.text || "Untitled checkbox"}
                            </button>
                          </div>
                        ))}
                    </section>
                  ))
              )}
            </>
          ) : mode === "board" && !["completed", "trash"].includes(view) ? (
            <div className="board">
              {columns.map((column) => (
                <section
                  className="board-column"
                  key={column.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (state.tasks.some((t) => t.id === id))
                      updateTask(id, { columnId: column.id });
                  }}
                >
                  <header>
                    <i style={{ background: column.color }} />
                    <button
                      className="column-name"
                      onClick={() =>
                        setDialog({
                          kind: "column",
                          id: column.id,
                          value: column.name,
                        })
                      }
                    >
                      {column.name}
                    </button>
                    <span>
                      {
                        sorted.filter(
                          (t) =>
                            t.columnId === column.id ||
                            (!columns.some((c) => c.id === t.columnId) &&
                              column.id === columns[0].id),
                        ).length
                      }
                    </span>
                    {columns.length > 1 && (
                      <IconButton
                        label={`Remove ${column.name} column`}
                        onClick={() => removeColumn(column.id)}
                      >
                        <X size={13} />
                      </IconButton>
                    )}
                  </header>
                  {sorted
                    .filter(
                      (t) =>
                        t.columnId === column.id ||
                        (!columns.some((c) => c.id === t.columnId) &&
                          column.id === columns[0].id),
                    )
                    .map((t) => taskRow(t, true))}
                  <button
                    className="board-add"
                    onClick={() => {
                      if (newTitle.trim()) addTask(undefined, column.id);
                      else {
                        quickRef.current?.focus();
                        setToast(
                          "Type a task title above, then use this column’s Add task.",
                        );
                      }
                    }}
                  >
                    <Plus size={14} />
                    Add task
                  </button>
                </section>
              ))}
              <button
                className="add-column"
                onClick={() => setDialog({ kind: "column", value: "" })}
              >
                <Plus size={16} />
                Add column
              </button>
            </div>
          ) : sorted.length ? (
            <>
              {view === "today" && (
                <div className="section-title task-section-label">
                  MY FOCUS<span>{todayCount}</span>
                </div>
              )}
              {view === "upcoming"
                ? Object.entries(
                    sorted.reduce(
                      (groups, task) => {
                        const key =
                          task.doDate && task.doDate >= today
                            ? task.doDate
                            : (task.deadline ?? "No date");
                        (groups[key] ??= []).push(task);
                        return groups;
                      },
                      {} as Record<string, Task[]>,
                    ),
                  )
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, tasks]) => (
                      <section key={date}>
                        <div className="section-title task-section-label">
                          {dateLabel(date)}
                          <span>{tasks.length}</span>
                        </div>
                        {tasks.map((t) => taskRow(t))}
                      </section>
                    ))
                : sorted.map((t) => taskRow(t))}
            </>
          ) : (
            <Empty
              icon={view === "today" ? Sun : view === "trash" ? Trash2 : Inbox}
              title={
                query
                  ? "No matching tasks"
                  : view === "today"
                    ? "A clear day ahead"
                    : view === "completed"
                      ? "Room for a little progress"
                      : view === "trash"
                        ? "Nothing in the trash"
                        : "A little room to think"
              }
              body={
                query
                  ? "Try another word."
                  : view === "today"
                    ? "Choose a few things to work on, or add a new task."
                    : view === "completed"
                      ? "Completed tasks will be kept here."
                      : view === "trash"
                        ? "Deleted tasks can be restored here."
                        : "Add your first task above."
              }
            />
          )}
          {view === "today" && earlier.length > 0 && (
            <section className="earlier">
              <button
                className="earlier-toggle"
                onClick={() => setShowEarlier(!showEarlier)}
              >
                {showEarlier ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
                Unfinished from earlier<span>{earlier.length}</span>
              </button>
              {showEarlier && earlier.map((t) => taskRow(t))}
            </section>
          )}
          {view === "today" && sorted.length > 0 && (
            <div className="focus-footer">
              <span />
              <Sun size={14} />
              <span /> <p>You decide what deserves today.</p>
            </div>
          )}
        </div>
        <footer className="workspace-footer">
          <span>
            {view === "checkboxes"
              ? `${openItems.length} open checkboxes`
              : `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`}
          </span>
          <button onClick={() => setSettings(true)}>
            <Keyboard size={14} />
            Shortcuts
          </button>
        </footer>
      </main>
      {selected && (
        <aside className="detail" key={selected.id}>
          <header className="detail-top">
            <button
              className="detail-back"
              onClick={() => setSelectedId(null)}
              aria-label="Back to tasks"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="detail-project">
              <i
                style={{
                  background:
                    projects.find((p) => p.id === selected.projectId)?.color ??
                    "#929bab",
                }}
              />
              <select
                aria-label="Task list"
                value={selected.projectId}
                onChange={(e) =>
                  updateTask(selected.id, { projectId: e.target.value })
                }
              >
                <option value="">Inbox</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="detail-actions">
              <span className="saved-label">
                {error
                  ? "Not saved"
                  : saving || notePending
                    ? "Saving…"
                    : "Saved"}
              </span>
              <div className="menu-anchor">
                <IconButton
                  label="Task actions"
                  active={menu}
                  onClick={() => setMenu(!menu)}
                >
                  <MoreHorizontal size={20} />
                </IconButton>
                {menu && (
                  <div className="dropdown">
                    <button
                      onClick={() => {
                        setState((s) => ({
                          ...s,
                          tasks: [
                            ...s.tasks,
                            {
                              ...selected,
                              id: uid(),
                              title: `${selected.title} (copy)`,
                              createdAt: now(),
                              updatedAt: now(),
                              example: false,
                            },
                          ],
                        }));
                        setMenu(false);
                        setToast("Task duplicated");
                      }}
                    >
                      <Layers size={15} />
                      Duplicate task
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        updateTask(selected.id, { deletedAt: now() });
                        setSelectedId(null);
                        setMenu(false);
                        setToast("Moved to Trash");
                      }}
                    >
                      <Trash2 size={15} />
                      Move to Trash
                    </button>
                  </div>
                )}
              </div>
              <IconButton
                label="Close task"
                onClick={() => setSelectedId(null)}
              >
                <X size={17} />
              </IconButton>
            </div>
          </header>
          <div className="detail-scroll">
            <div className="task-title-editor">
              <button
                className={`task-check large ${selected.completedAt ? "checked" : ""}`}
                aria-label={
                  selected.completedAt ? "Reopen task" : "Complete task"
                }
                onClick={() => complete(selected)}
              >
                {selected.completedAt && <Check size={14} />}
              </button>
              <textarea
                {...noTextSuggestions}
                aria-label="Task title"
                rows={2}
                value={selected.title}
                onChange={(e) =>
                  updateTask(selected.id, { title: e.target.value })
                }
                onBlur={() => {
                  if (!selected.title.trim())
                    updateTask(selected.id, { title: "Untitled task" });
                }}
              />
            </div>
            <div className="date-fields">
              <DateField
                label="Do date"
                value={selected.doDate}
                icon={Sun}
                onChange={(value) => updateTask(selected.id, { doDate: value })}
                today={today}
              />
              <DateField
                label="Deadline"
                value={selected.deadline}
                icon={Flag}
                onChange={(value) =>
                  updateTask(selected.id, { deadline: value })
                }
                today={today}
              />
            </div>
            <div className="status-field">
              <span>Status</span>
              <i
                style={{
                  background: columns.find((c) => c.id === selected.columnId)
                    ?.color,
                }}
              />
              <select
                aria-label="Task status"
                value={selected.columnId}
                onChange={(e) =>
                  updateTask(selected.id, { columnId: e.target.value })
                }
              >
                {columns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <TaskTags
              tags={tags}
              tagIds={selected.tagIds ?? []}
              onChange={(tagIds) => updateTask(selected.id, { tagIds })}
              onCreate={(draft) => createTag(draft, selected.id)}
            />
            <div className="editor-separator" />
            <TaskEditor
              key={selected.id}
              taskId={selected.id}
              content={selected.notes}
              onChange={(notes) => updateTask(selected.id, { notes })}
              onPendingChange={setNotePending}
              onAttach={attach}
              vimEnabled={vimEnabled}
            />
            {selected.attachments.length > 0 && (
              <section className="attachments">
                <div className="section-title">
                  ATTACHMENTS<span>{selected.attachments.length}</span>
                </div>
                {selected.attachments.map((a) => (
                  <div className="attachment" key={a.id}>
                    <button onClick={() => setAttachmentPreview(a)}>
                      {a.mime.startsWith("image/") ? (
                        <img src={a.url} alt="" />
                      ) : (
                        <span className="pdf-icon">
                          <FileText size={22} />
                        </span>
                      )}
                      <span>
                        <strong>{a.name}</strong>
                        <small>
                          {a.mime === "application/pdf"
                            ? "PDF document"
                            : a.mime.startsWith("image/")
                              ? "Image"
                              : "File"}{" "}
                          ·{" "}
                          {a.size < 1024 * 1024
                            ? `${Math.max(1, Math.round(a.size / 1024))} KB`
                            : `${(a.size / 1024 / 1024).toFixed(1)} MB`}
                        </small>
                      </span>
                      <ExternalLink size={14} />
                    </button>
                    <IconButton
                      label={`Remove attachment ${a.name}`}
                      onClick={() =>
                        updateTask(selected.id, {
                          attachments: selected.attachments.filter(
                            (v) => v.id !== a.id,
                          ),
                        })
                      }
                    >
                      <X size={13} />
                    </IconButton>
                  </div>
                ))}
              </section>
            )}
            <button className="attach-link" onClick={attach}>
              <Paperclip size={15} />
              Attach an image or PDF
            </button>
            <input
              type="file"
              hidden
              multiple
              ref={fileRef}
              accept="image/*,application/pdf"
              onChange={(e) => void attachFiles(e.target.files)}
            />
          </div>
          <footer className="detail-footer">
            <span>
              {selected.example
                ? "Example task · make it your own"
                : `Created ${new Date(selected.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </span>
            <span>Markdown & LaTeX</span>
          </footer>
        </aside>
      )}
      {settings && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header>
              <h2 id="settings-title">A place for your work</h2>
              <IconButton
                label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X size={20} />
              </IconButton>
            </header>
            <div className="settings-content">
              <h3>Editor</h3>
              <label className="editor-setting" htmlFor="vim-mode-toggle">
                <span>
                  <strong>Vim mode</strong>
                  <span>Navigate and edit notes with Vim keys.</span>
                </span>
                <input
                  id="vim-mode-toggle"
                  type="checkbox"
                  role="switch"
                  aria-label="Vim mode"
                  checked={vimEnabled}
                  onChange={(event) => setVimEnabled(event.target.checked)}
                />
              </label>
              {vimEnabled && (
                <p className="vim-setting-help">
                  <kbd>i</kbd> to write · <kbd>Esc</kbd> for Normal mode ·{" "}
                  <kbd>v</kbd> to select. Move with <kbd>h j k l</kbd> or{" "}
                  <kbd>w b</kbd>. Use <kbd>dd</kbd> to cut a line, <kbd>yy</kbd>{" "}
                  to copy, <kbd>p</kbd> to paste, and <kbd>u</kbd> to undo.
                </p>
              )}
              <h3>Storage & sync</h3>
              <div className="storage-card">
                {storage.kind === "icloud" ? (
                  <Cloud size={23} />
                ) : (
                  <HardDrive size={23} />
                )}
                <div>
                  <strong>
                    {storage.kind === "icloud"
                      ? "iCloud Drive"
                      : storage.kind === "folder"
                        ? "Selected folder"
                        : "Saved on this device"}
                  </strong>
                  <p>
                    {storage.message ??
                      (isNative()
                        ? "Tasks and attachments are saved automatically."
                        : "This browser keeps its own local workspace. Use the Mac app for iCloud Drive sync.")}
                  </p>
                </div>
              </div>
              {storage.path && (
                <div className="storage-path">{storage.path}</div>
              )}
              {isNative() && (
                <button
                  className="secondary-button"
                  onClick={() => nativeSend({ action: "chooseFolder" })}
                >
                  <FolderOpen size={16} />
                  Choose workspace folder
                </button>
              )}
              <button className="secondary-button" onClick={exportData}>
                <Download size={16} />
                Export task data
              </button>
              <p className="muted">
                The JSON export includes notes and attachment references. To
                back up attached files too, copy the whole workspace folder.
              </p>
              <h3>Keyboard shortcuts</h3>
              <div className="shortcut-row">
                <span>New task</span>
                <kbd>⌘ N</kbd>
              </div>
              <div className="shortcut-row">
                <span>Search tasks</span>
                <kbd>⌘ K</kbd>
              </div>
              <div className="shortcut-row">
                <span>Bold / italic in notes</span>
                <kbd>⌘ B / ⌘ I</kbd>
              </div>
              <div className="shortcut-row">
                <span>Undo in notes</span>
                <kbd>⌘ Z</kbd>
              </div>
              <div className="shortcut-row">
                <span>Indent / outdent list item</span>
                <kbd>Tab / ⇧ Tab</kbd>
              </div>
              <div className="shortcut-row">
                <span>Toggle current checkbox</span>
                <kbd>⌘ ⇧ Enter</kbd>
              </div>
              <div className="shortcut-row">
                <span>Continue below a quote or table</span>
                <kbd>⌘ Enter</kbd>
              </div>
              <div className="shortcut-row">
                <span>Open a link in notes</span>
                <kbd>⌘ click</kbd>
              </div>
              <h3>Make it yours</h3>
              <p className="muted">
                The example tasks show how do dates, deadlines, and rich notes
                work together.
              </p>
              <button
                className="secondary-button"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    tasks: s.tasks.map((t) =>
                      t.example
                        ? { ...t, deletedAt: now(), updatedAt: now() }
                        : t,
                    ),
                  }));
                  setSelectedId(null);
                  setToast("Example tasks moved to Trash");
                }}
              >
                Move example tasks to Trash
              </button>
              <p className="version">Daymark 0.1 · Built around your day</p>
            </div>
          </section>
        </div>
      )}
      {tagDialog && (
        <TagDialog
          key={tagDialog.id ?? "new"}
          tag={tags.find((tag) => tag.id === tagDialog.id) ?? null}
          tags={tags}
          onSave={saveTag}
          onDelete={tagDialog.id ? () => deleteTag(tagDialog.id!) : undefined}
          onClose={() => setTagDialog(null)}
        />
      )}
      {dialog && (
        <div className="modal-backdrop">
          <form
            className="modal small-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onSubmit={saveDialog}
          >
            <header>
              <h2 id="dialog-title">
                {dialog.id ? "Rename" : "New"}{" "}
                {dialog.kind === "project" ? "list" : "column"}
              </h2>
              <IconButton
                type="button"
                label="Cancel"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </IconButton>
            </header>
            <input
              autoFocus
              {...noTextSuggestions}
              aria-label="Name"
              placeholder={
                dialog.kind === "project"
                  ? "e.g. Research"
                  : "e.g. Waiting for feedback"
              }
              value={dialog.value}
              onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
            />
            <div className="record-options">
              {dialog.id && (
                <div className="color-options" aria-label="Color">
                  {palette.map((color) => (
                    <button
                      type="button"
                      aria-label={`Use color ${color}`}
                      key={color}
                      style={{ background: color }}
                      onClick={() =>
                        setState((s) => {
                          const field =
                            dialog.kind === "project" ? "projects" : "columns";
                          return {
                            ...s,
                            [field]: s[field].map((v) =>
                              v.id === dialog.id
                                ? { ...v, color, updatedAt: now() }
                                : v,
                            ),
                          };
                        })
                      }
                    />
                  ))}
                </div>
              )}
              {dialog.kind === "column" && dialog.id && (
                <div className="column-order">
                  <button
                    type="button"
                    disabled={columns[0]?.id === dialog.id}
                    onClick={() => moveColumn(dialog.id!, -1)}
                  >
                    ← Move left
                  </button>
                  <button
                    type="button"
                    disabled={columns.at(-1)?.id === dialog.id}
                    onClick={() => moveColumn(dialog.id!, 1)}
                  >
                    Move right →
                  </button>
                </div>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={!dialog.value.trim()}
              >
                {dialog.id ? "Save" : "Create"}
              </button>
            </footer>
          </form>
        </div>
      )}
      {attachmentPreview && (
        <div className="modal-backdrop">
          <section
            className="modal preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={attachmentPreview.name}
          >
            <header>
              <h2>{attachmentPreview.name}</h2>
              <IconButton
                label="Open attachment externally"
                onClick={() =>
                  isNative()
                    ? nativeSend({
                        action: "openAttachment",
                        attachment: attachmentPreview,
                      })
                    : window.open(attachmentPreview.url, "_blank", "noopener")
                }
              >
                <ExternalLink size={18} />
              </IconButton>
              <IconButton
                label="Close preview"
                onClick={() => setAttachmentPreview(null)}
              >
                <X size={20} />
              </IconButton>
            </header>
            {attachmentPreview.mime.startsWith("image/") ? (
              <img src={attachmentPreview.url} alt={attachmentPreview.name} />
            ) : attachmentPreview.mime === "application/pdf" ? (
              <object data={attachmentPreview.url} type="application/pdf">
                <p>This PDF can be opened in your default viewer.</p>
                <button
                  className="primary-button"
                  onClick={() =>
                    isNative()
                      ? nativeSend({
                          action: "openAttachment",
                          attachment: attachmentPreview,
                        })
                      : window.open(attachmentPreview.url, "_blank", "noopener")
                  }
                >
                  Open PDF
                </button>
              </object>
            ) : (
              <div className="file-preview-fallback">
                <FileText size={40} />
                <p>Open this file in its default app.</p>
                <button
                  className="primary-button"
                  onClick={() =>
                    isNative()
                      ? nativeSend({
                          action: "openAttachment",
                          attachment: attachmentPreview,
                        })
                      : window.open(attachmentPreview.url, "_blank", "noopener")
                  }
                >
                  Open file
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Empty({ icon: Icon, title, body }: any) {
  return (
    <div className="empty-state">
      <Icon size={30} strokeWidth={1.4} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}
function DateField({
  label,
  value,
  icon: Icon,
  onChange,
  today,
}: {
  label: string;
  value: string | null;
  icon: any;
  onChange: (v: string | null) => void;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`date-field ${label === "Do date" && value === today ? "today-date" : ""} ${label === "Deadline" && value && value < today ? "overdue-date" : ""}`}
    >
      <button className="date-field-trigger" onClick={() => setOpen(!open)}>
        <Icon size={16} />
        <span>
          <small>{label}</small>
          <strong>{dateLabel(value)}</strong>
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="date-popover">
          <strong>{label}</strong>
          <div className="date-shortcuts">
            <button
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              Today
            </button>
            <button
              onClick={() => {
                onChange(addDays(1));
                setOpen(false);
              }}
            >
              Tomorrow
            </button>
          </div>
          <input
            autoFocus
            type="date"
            aria-label={label}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          />
          <div className="date-popover-footer">
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear date
            </button>
            <button onClick={() => setOpen(false)}>Done</button>
          </div>
          {label === "Deadline" && (
            <p>The final deadline, independent of when you work.</p>
          )}
        </div>
      )}
    </div>
  );
}
export default App;
