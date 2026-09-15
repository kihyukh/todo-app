import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Sun,
  Play,
  Clock3,
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
import PdfPreview from "./PdfPreview";
import {
  DeleteListDialog,
  ListOptions,
  type ListMenuAnchor,
} from "./ListActions";
import { flushSync } from "react-dom";
import { deleteList, undoDeleteList, type ListDeletionReceipt } from "./lists";
import { readBrowserNoteFile } from "./note-file-storage";
import { nativeAttachmentLink } from "./note-links";
import { CompletionMark, useTaskCompletion } from "./TaskCompletion";
import { TaskDragHandle, TaskDragNotice, useTaskDrag } from "./TaskDrag";
import { compareManualTasks, isActiveTask } from "./task-drag";
import {
  readCompletionSoundPreference,
  writeCompletionSoundPreference,
} from "./completion-sound";
import { detailLayoutForWidth, PaneDivider, usePaneWidths } from "./PaneResize";
import {
  compareTaskPriority,
  isDueSoon,
  planningCandidates,
  priorityLabels,
  taskPriority,
} from "./task-planning";
import { useCalendars } from "./calendar-client";
import CalendarWorkspace, {
  CalendarSettings,
  TaskCalendarLinks,
} from "./CalendarWorkspace";
import TaskScheduleField from "./TaskScheduleField";
import { PrivacyInfo } from "./PrivacyInfo";
import { APP_NAME, APP_VERSION } from "./brand";
import { installWindowDragging } from "./window-drag";
import {
  dismissSoftwareKeyboard,
  finishIOSWorkspaceSetup,
  isNativeIOS,
  isTextEntry,
  needsIOSWorkspaceSetup,
  usesTouchInterface,
} from "./platform";
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
  agendaEntries,
  addDays,
  dateKey,
  dateLabel,
  emptyDoc,
  hasMissedWork,
  isScheduledOn,
  nextWorkDate,
  now,
  schedulePatch,
  uid,
  workDates,
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
  | "calendar"
  | "all"
  | "inbox"
  | "checkboxes"
  | "completed"
  | "trash"
  | `project:${string}`
  | `tag:${string}`;
type Dialog = { kind: "project" | "column"; id?: string; value: string } | null;
const palette = [
  "#24704f",
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
  const [touch] = useState(usesTouchInterface);
  const [touchFocus, setTouchFocus] = useState(false);
  const [workspaceSetup, setWorkspaceSetup] = useState(needsIOSWorkspaceSetup);
  const showWorkspaceSetup =
    workspaceSetup && isNativeIOS() && storage.kind === "local";
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    detailLayoutForWidth(window.innerWidth) === "docked"
      ? "example-review"
      : null,
  );
  const [mode, setMode] = useState<"list" | "board">("list");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [vimEnabled, setVimEnabled] = useState(readVimPreference);
  const [completionSound, setCompletionSound] = useState(
    readCompletionSoundPreference,
  );
  const completion = useTaskCompletion();
  const [notePending, setNotePending] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tagDialog, setTagDialog] = useState<{ id?: string } | null>(null);
  const [listMenu, setListMenu] = useState<ListMenuAnchor | null>(null);
  const [listDelete, setListDelete] = useState<{
    id: string;
    returnFocus?: HTMLElement;
  } | null>(null);
  const [listUndo, setListUndo] = useState<ListDeletionReceipt | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [plan, setPlan] = useState(false);
  const [planFilter, setPlanFilter] = useState<"all" | "urgent" | "progress">(
    "all",
  );
  const calendar = useCalendars();
  const [menu, setMenu] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState<Attachment | null>(
    null,
  );
  useEffect(() => {
    if (!attachmentPreview) return;
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Close preview"]')
        ?.focus(),
    );
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [attachmentPreview]);
  useEffect(
    () => () => {
      if (attachmentPreview?.url.startsWith("blob:"))
        URL.revokeObjectURL(attachmentPreview.url);
    },
    [attachmentPreview],
  );
  const [today, setToday] = useState(dateKey());
  const [toast, setToast] = useState("");
  const drag = useTaskDrag({
    state,
    setState,
    view,
    mode,
    query,
    onCommit: () => setToast(""),
  });
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
  const deletingList = projects.find(
    (project) => project.id === listDelete?.id,
  );
  const deletingTasks = state.tasks.filter(
    (task) => task.projectId === listDelete?.id,
  );
  useEffect(() => {
    // A synced deletion must not leave a view that creates new tasks in that list.
    if (
      view.startsWith("project:") &&
      state.projects.some((p) => p.id === view.slice(8) && p.deletedAt)
    ) {
      setView("inbox");
      setQuery("");
    }
    if (listMenu && !projects.some((p) => p.id === listMenu.id))
      setListMenu(null);
    if (listDelete && !deletingList) setListDelete(null);
    if (
      listUndo &&
      !state.projects.some(
        (project) =>
          project.id === listUndo.id &&
          project.deletedAt === listUndo.deletedAt,
      )
    )
      setListUndo(null);
  }, [state.projects, view, listMenu, listDelete, listUndo]);
  const panes = usePaneWidths(!!selected);
  const detailRef = useRef<HTMLElement>(null);
  const detailWasOpen = useRef(false);
  useLayoutEffect(() => {
    const opening = ready && !!selected && !detailWasOpen.current;
    detailWasOpen.current = ready && !!selected;
    const pane = detailRef.current;
    if (
      !opening ||
      panes.detailLayout !== "floating" ||
      !pane?.animate ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // Animate only a closed → open transition. Task changes and docking keep
    // their existing editor lifecycle and cancel any unfinished entrance.
    const entrance = pane.animate(
      [
        { transform: "translateX(calc(100% + 24px))" },
        { transform: "translateX(0)" },
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    return () => entrance.cancel();
  }, [ready, selected?.id, panes.detailLayout]);
  useEffect(() => {
    if (
      !ready ||
      window.__DAYMARK_PLATFORM__ !== "macos" ||
      !panes.shell.current
    )
      return;
    return installWindowDragging(panes.shell.current, (gesture) =>
      nativeSend({ action: "dragWindow", ...gesture }),
    );
  }, [ready, panes.shell]);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = titleRef.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(180, Math.max(30, field.scrollHeight))}px`;
  }, [selected?.id, selected?.title, panes.fitted.detail, panes.width]);
  const progressColumn =
    columns.find((column) => column.id === "progress") ??
    columns.find((column) => /in progress|doing|working/i.test(column.name));
  const candidates = planningCandidates(
    active,
    today,
    progressColumn?.id,
    planFilter,
  );
  const imminent = active.filter((task) => isDueSoon(task, today));
  const overdueCount = imminent.filter((task) => task.deadline! < today).length;
  const plannedMatches = active
    .filter(
      (task) =>
        isScheduledOn(task, today) &&
        (planFilter === "urgent"
          ? isDueSoon(task, today)
          : planFilter === "progress" &&
            !!progressColumn &&
            task.columnId === progressColumn.id),
    )
    .sort(compareTaskPriority);
  const openItems = useMemo(
    () =>
      state.tasks
        .filter((t) => !t.deletedAt && !t.completedAt)
        .flatMap((task) =>
          extractCheckboxes(task.notes)
            .filter((c) => !c.checked)
            .map((check) => ({ task, ...check })),
        ),
    [state.tasks],
  );
  const checkboxQuery = query.trim().toLowerCase();
  const checkboxGroups = useMemo(() => {
    const groups = new Map<string, { task: Task; items: typeof openItems }>();
    for (const item of openItems) {
      if (checkboxQuery) {
        const searchable = `${item.text} ${item.task.title} ${taskTags(
          item.task,
          state,
        )
          .map((tag) => tag.name)
          .join(" ")}`.toLowerCase();
        if (!searchable.includes(checkboxQuery)) continue;
      }
      const group = groups.get(item.task.id);
      if (group) group.items.push(item);
      else groups.set(item.task.id, { task: item.task, items: [item] });
    }
    return [...groups.values()];
  }, [openItems, checkboxQuery, state.tags]);
  const shownCheckboxes = checkboxGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const title = view.startsWith("tag:")
    ? (selectedTag?.name ?? "Tag")
    : view.startsWith("project:")
      ? (projects.find((p) => p.id === view.slice(8))?.name ?? "List")
      : (
          {
            today: "Today",
            upcoming: "Upcoming",
            calendar: "Calendar",
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
    } else if (
      view !== "trash" &&
      t.completedAt &&
      !completion.completing.has(t.id)
    )
      return false;
    if (view === "today" && !isScheduledOn(t, today)) return false;
    if (view === "upcoming" && !(nextWorkDate(t, today) || t.deadline))
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
  const nextTaskDate = (task: Task) =>
    [nextWorkDate(task, today), task.deadline]
      .filter((value): value is string => !!value && value >= today)
      .sort()[0] ?? "9999";
  const sorted = [...visible].sort((a, b) =>
    drag.reorderEnabled
      ? compareManualTasks(a, b, view)
      : view === "completed" || view === "trash"
        ? 0
        : view === "upcoming"
          ? nextTaskDate(a).localeCompare(nextTaskDate(b)) ||
            compareTaskPriority(a, b)
          : (view === "today" && progressColumn
              ? Number(b.columnId === progressColumn.id) -
                Number(a.columnId === progressColumn.id)
              : 0) || compareTaskPriority(a, b),
  );
  const upcoming =
    view === "upcoming"
      ? [
          ...visible
            .filter((task) => task.deadline && task.deadline < today)
            .map((task) => ({
              date: task.deadline!,
              task,
              work: false,
              deadline: true,
            })),
          ...agendaEntries(visible, today),
        ].sort(
          (a, b) =>
            a.date.localeCompare(b.date) || compareTaskPriority(a.task, b.task),
        )
      : [];
  const earlier = state.tasks.filter((task) =>
    hasMissedWork(
      completion.completing.has(task.id)
        ? { ...task, completedAt: null }
        : task,
      today,
    ),
  );
  const todayCount = active.filter((t) => isScheduledOn(t, today)).length;
  const completedToday = state.tasks.filter(
    (t) =>
      !t.deletedAt &&
      t.completedAt &&
      dateKey(new Date(t.completedAt)) === today,
  ).length;
  useEffect(() => {
    if (isNativeIOS() && ready && storage.kind !== "local") {
      finishIOSWorkspaceSetup();
      setWorkspaceSetup(false);
    }
  }, [ready, storage.kind]);
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
      if (
        listDelete &&
        (e.metaKey || e.ctrlKey) &&
        ["k", "n"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        add();
      }
      if (e.key === "Escape") {
        if (
          panes.detailLayout === "floating" &&
          !isTextEntry(e.target) &&
          !settings &&
          !dialog &&
          !tagDialog &&
          !listMenu &&
          !listDelete &&
          !menu &&
          !plan &&
          !attachmentPreview
        )
          setSelectedId(null);
        setSettings(false);
        setDialog(null);
        setTagDialog(null);
        setListMenu(null);
        setListDelete(null);
        setMenu(false);
        setPlan(false);
        setAttachmentPreview(null);
      }
    }
    const add = () => {
      if (listDelete) return;
      if (panes.detailLayout !== "docked") setSelectedId(null);
      if (["checkboxes", "completed", "trash", "calendar"].includes(view))
        setView("today");
      requestAnimationFrame(() => quickRef.current?.focus());
    };
    window.addEventListener("keydown", key);
    window.addEventListener("daymark-new-task", add);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("daymark-new-task", add);
    };
  }, [
    view,
    panes.detailLayout,
    settings,
    dialog,
    tagDialog,
    listMenu,
    listDelete,
    menu,
    plan,
    attachmentPreview,
  ]);
  function changeView(v: View) {
    if (panes.detailLayout !== "docked" || v === "calendar")
      setSelectedId(null);
    setView(v);
    setQuery("");
    setSidebar(false);
    setPlan(false);
    setListMenu(null);
  }
  function confirmListDeletion() {
    if (!listDelete) return;
    const id = listDelete.id;
    const stamp = now();
    const deletion: { result: ReturnType<typeof deleteList> } = {
      result: null,
    };
    // Commit this explicit action before showing Undo, so its receipt includes
    // any task changes already queued by the editor or another device.
    flushSync(() => {
      setState((current) => {
        deletion.result = deleteList(current, id, stamp);
        return deletion.result?.state ?? current;
      });
    });
    const result = deletion.result;
    if (!result) {
      setListDelete(null);
      return;
    }
    setListUndo(result.receipt);
    setListDelete(null);
    setToast("");
    drag.clearNotice();
    if (view === `project:${id}`) {
      changeView("inbox");
    }
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Undo list deletion"]')
        ?.focus({ preventScroll: true }),
    );
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
  function startWorking(task: Task) {
    updateTask(task.id, {
      ...schedulePatch([...workDates(task), today]),
      ...(progressColumn ? { columnId: progressColumn.id } : {}),
    });
    setSelectedId(task.id);
  }
  function complete(task: Task) {
    if (task.completedAt) completion.cancel(task.id);
    else {
      setToast("");
      completion.celebrate(task);
    }
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
      ...schedulePatch(view === "today" ? [today] : []),
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
  async function openNoteFile(href: string, label: string) {
    const url = nativeAttachmentLink(href);
    if (!url) return;
    const previewMime = (name: string, mime: string) => {
      if (mime === "application/pdf" || mime.startsWith("image/")) return mime;
      const extension = name.split(".").pop()?.toLowerCase() ?? "";
      return (
        {
          pdf: "application/pdf",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
          heic: "image/heic",
        } as Record<string, string>
      )[extension];
    };
    if (isNative()) {
      const existing = state.tasks
        .flatMap((task) => task.attachments)
        .find((file) => file.url === url);
      const mime = previewMime(url, existing?.mime ?? "");
      if (!mime || mime === "application/pdf") {
        nativeSend({ action: "openAttachment", url });
        return;
      }
      setAttachmentPreview({
        id: url,
        name: label || "File",
        size: 0,
        url,
        ...existing,
        mime,
      });
      return;
    }
    const file = await readBrowserNoteFile(url);
    if (!file)
      throw new Error(
        `This file is not stored in this browser. Open it in the ${APP_NAME} app where it was added.`,
      );
    const mime = previewMime(file.attachment.name, file.attachment.mime);
    const objectUrl = URL.createObjectURL(
      mime ? file.data.slice(0, file.data.size, mime) : file.data,
    );
    if (mime === "application/pdf" || mime?.startsWith("image/")) {
      setAttachmentPreview({ ...file.attachment, mime, url: objectUrl });
    } else {
      const download = document.createElement("a");
      download.href = objectUrl;
      download.download = file.attachment.name;
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
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
    link.download = `${APP_NAME}-${today}.json`;
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
  function taskRow(
    task: Task,
    compact = false,
    occurrence?: { work: boolean; deadline: boolean },
  ) {
    const checks = extractCheckboxes(task.notes),
      done = checks.filter((c) => c.checked).length;
    const project = projects.find((p) => p.id === task.projectId);
    const dates = workDates(task);
    const planned = isScheduledOn(task, today);
    const nextDate = nextWorkDate(task, today) ?? dates[dates.length - 1];
    const otherDates = dates.length - 1;
    const celebrating =
      !!task.completedAt && completion.completing.has(task.id);
    return (
      <div
        key={task.id}
        className={`task-row-shell ${celebrating && !["completed", "trash"].includes(view) ? "is-retiring" : ""}`}
      >
        <div className="task-row-clip">
          <div
            data-task-id={task.id}
            className={`task-row ${selectedId === task.id ? "selected" : ""} ${compact ? "compact" : ""} ${celebrating ? "is-completing" : ""}`}
            {...drag.rowProps(task, compact)}
          >
            {drag.reorderEnabled && !compact && isActiveTask(task) && (
              <TaskDragHandle task={task} drag={drag} />
            )}
            <button
              className={`task-check ${task.completedAt ? "checked" : ""} ${celebrating ? "is-celebrating" : ""}`}
              aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${task.title}`}
              onClick={() => {
                drag.clearNotice();
                complete(task);
              }}
            >
              <CompletionMark
                checked={!!task.completedAt}
                celebrating={celebrating}
              />
            </button>
            <button
              className="task-content"
              data-open-task
              onClick={() => setSelectedId(task.id)}
            >
              <span className={`task-title ${task.completedAt ? "done" : ""}`}>
                <span className="task-title-ink">{task.title}</span>
              </span>
              <span className="task-metadata">
                {project && (
                  <span>
                    <i style={{ background: project.color }} />
                    {project.name}
                  </span>
                )}
                {taskPriority(task) > 0 && (
                  <span
                    className={`priority-mark priority-${taskPriority(task)}`}
                  >
                    <Flag size={11} />
                    {priorityLabels[taskPriority(task)]}
                  </span>
                )}
                {progressColumn && task.columnId === progressColumn.id && (
                  <span className="task-working">
                    <Clock3 size={11} />
                    In progress
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
              (occurrence || nextDate) && (
                <span
                  className={`row-do-date ${occurrence?.deadline ? "row-deadline-day" : ""}`}
                  title={
                    occurrence
                      ? occurrence.work && occurrence.deadline
                        ? "Scheduled work day and deadline"
                        : occurrence.work
                          ? "Scheduled work day"
                          : "Final deadline"
                      : `Work on ${dates.map((date) => dateLabel(date, false)).join(", ")}`
                  }
                >
                  {occurrence?.deadline && !occurrence.work ? (
                    <Flag size={12} />
                  ) : (
                    <CalendarDays size={12} />
                  )}
                  {occurrence ? (
                    occurrence.work && occurrence.deadline ? (
                      "Work · Due"
                    ) : occurrence.work ? (
                      "Work day"
                    ) : (
                      "Deadline"
                    )
                  ) : (
                    <>
                      {dateLabel(nextDate ?? null)}
                      {otherDates > 0 && (
                        <span className="work-date-count">+{otherDates}</span>
                      )}
                    </>
                  )}
                </span>
              )
            )}
            {!task.deletedAt && !task.completedAt && (
              <button
                type="button"
                className={`start-task ${progressColumn && task.columnId === progressColumn.id ? "is-working" : ""}`}
                aria-label={`Work on ${task.title}`}
                title="Work on this task"
                data-open-task
                onClick={() => startWorking(task)}
              >
                <Play size={13} />
              </button>
            )}
            {!task.deletedAt && (
              <button
                className={`plan-task ${planned ? "planned" : ""}`}
                title={planned ? "Remove from Today" : "Do today"}
                aria-label={`${planned ? "Remove from Today" : "Do today"}: ${task.title}`}
                onClick={() =>
                  updateTask(
                    task.id,
                    schedulePatch(
                      planned
                        ? dates.filter((date) => date !== today)
                        : [...dates, today],
                    ),
                  )
                }
              >
                <Sun size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  const navigation = [
    { id: "today", label: "Today", icon: Sun, count: todayCount },
    { id: "calendar", label: "Calendar", icon: CalendarDays, count: null },
    { id: "upcoming", label: "Upcoming", icon: Clock3, count: null },
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
        <p>{error || "Opening your workspace…"}</p>
      </div>
    );
  return (
    <div
      ref={panes.shell}
      style={panes.style}
      data-detail-layout={panes.detailLayout}
      className={`app-shell ${selected ? "has-detail" : ""} ${sidebar ? "sidebar-open" : ""} ${touch ? "is-touch-device" : ""} ${window.__DAYMARK_PLATFORM__ === "macos" ? "is-native-mac" : ""} ${touchFocus ? "has-touch-focus" : ""}`}
      onClickCapture={(event) => {
        // Task-opening controls switch directly. Closing here first would
        // unmount the editor between React's capture and bubble handlers.
        if (
          panes.detailLayout === "floating" &&
          event.target instanceof Element &&
          event.target.closest(".workspace, .sidebar") &&
          !event.target.closest("[data-open-task]")
        )
          setSelectedId(null);
      }}
      onFocusCapture={(event) => {
        if (touch && isTextEntry(event.target)) setTouchFocus(true);
      }}
      onBlurCapture={(event) => {
        if (touch && !isTextEntry(event.relatedTarget)) setTouchFocus(false);
      }}
    >
      <PaneDivider kind="sidebar" layout={panes} hasDetail={!!selected} />
      <PaneDivider kind="detail" layout={panes} hasDetail={!!selected} />
      <aside className="sidebar">
        {window.__DAYMARK_PLATFORM__ === "macos" && (
          <div
            className="sidebar-window-drag"
            data-window-drag
            aria-hidden="true"
          />
        )}
        <div className="sidebar-search-row">
          <div className="search">
            <Search size={15} />
            <input
              {...noTextSuggestions}
              ref={searchRef}
              aria-label={
                view === "checkboxes" ? "Search checkboxes" : "Search tasks"
              }
              placeholder={
                view === "checkboxes"
                  ? "Search checkboxes"
                  : view === "completed"
                    ? "Search completed tasks"
                    : view === "trash"
                      ? "Search Trash"
                      : "Search tasks"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (
                  e.target.value &&
                  !["completed", "trash", "checkboxes"].includes(view)
                )
                  setView("all");
              }}
            />
            <kbd>⌘ K</kbd>
          </div>
          <IconButton label="Hide sidebar" onClick={() => setSidebar(false)}>
            <PanelLeftClose size={17} />
          </IconButton>
        </div>
        <nav aria-label="Task views">
          {navigation.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              {...(id === "inbox"
                ? drag.destinationProps({ kind: "project", id: "" })
                : {})}
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
                {...drag.destinationProps({ kind: "project", id: project.id })}
                onClick={() => changeView(`project:${project.id}`)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setListMenu({
                    id: project.id,
                    element: event.currentTarget,
                    ...(event.clientX || event.clientY
                      ? { point: { x: event.clientX, y: event.clientY } }
                      : {}),
                  });
                }}
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
            dropProps={(id) => drag.destinationProps({ kind: "tag", id })}
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
        className={`workspace ${mode === "board" && view !== "checkboxes" && view !== "calendar" ? "board-workspace" : ""} ${view === "calendar" ? "calendar-workspace-container" : ""}`}
      >
        <div className="workspace-top" data-window-drag>
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
        <header className="workspace-header" data-window-drag>
          <h1>{title}</h1>
          <div className="view-actions">
            {!["checkboxes", "trash", "completed", "calendar"].includes(
              view,
            ) && (
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
                label="List options"
                aria-haspopup="menu"
                aria-expanded={listMenu?.id === view.slice(8)}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) =>
                  setListMenu(
                    listMenu
                      ? null
                      : { id: view.slice(8), element: event.currentTarget },
                  )
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
              onClick={() => {
                setPlanFilter("all");
                setPlan(!plan);
              }}
              className={`text-button ${plan ? "chosen" : ""}`}
            >
              <Plus size={14} />
              Plan your day
            </button>
          </div>
        )}
        {view === "today" && (
          <div className="today-briefing" aria-label="Planning overview">
            <button
              className={overdueCount > 0 ? "has-overdue" : ""}
              onClick={() => {
                setPlanFilter("urgent");
                setPlan(true);
              }}
            >
              <Flag size={13} />
              <strong>{imminent.length}</strong> due soon
              {overdueCount > 0 && <span>· {overdueCount} overdue</span>}
            </button>
            <button
              onClick={() => {
                setPlanFilter("progress");
                setPlan(true);
              }}
            >
              <Clock3 size={13} />
              <strong>
                {
                  active.filter(
                    (task) =>
                      progressColumn && task.columnId === progressColumn.id,
                  ).length
                }
              </strong>{" "}
              in progress
            </button>
            {completedToday > 0 && (
              <span>
                <CheckCheck size={13} />
                {completedToday} done today
              </span>
            )}
          </div>
        )}
        {error && !(touch && selected) && !showWorkspaceSetup && (
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
            <p>
              Adding Today keeps other work days and the deadline unchanged.
            </p>
            <div
              className="planning-filters"
              role="group"
              aria-label="Suggestions"
            >
              {(["all", "urgent", "progress"] as const).map((filter) => (
                <button
                  key={filter}
                  aria-pressed={planFilter === filter}
                  onClick={() => setPlanFilter(filter)}
                >
                  {filter === "all"
                    ? "All tasks"
                    : filter === "urgent"
                      ? "Due soon"
                      : "In progress"}
                </button>
              ))}
            </div>
            {candidates.length ? (
              candidates.map((t) => (
                <button
                  key={t.id}
                  className="planning-row"
                  onClick={() => {
                    updateTask(t.id, schedulePatch([...workDates(t), today]));
                    setToast("Added to Today");
                  }}
                >
                  <Plus size={16} />
                  <span>{t.title}</span>
                  {t.deadline && <small>Due {dateLabel(t.deadline)}</small>}
                </button>
              ))
            ) : !plannedMatches.length ? (
              <p>
                {planFilter === "all"
                  ? "Everything is already on your list for today."
                  : "These tasks are already planned for today, or there are none in this group."}
              </p>
            ) : null}
            {plannedMatches.length > 0 && (
              <div className="planning-already">
                <span>Already on Today</span>
                {plannedMatches.map((task) => (
                  <button
                    key={task.id}
                    className="planning-row"
                    data-open-task
                    onClick={() => setSelectedId(task.id)}
                  >
                    <Sun size={15} />
                    <span>{task.title}</span>
                    <small>Open task</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!["checkboxes", "completed", "trash", "calendar"].includes(view) && (
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
        {view === "calendar" ? (
          <CalendarWorkspace
            tasks={state.tasks}
            api={calendar}
            onOpenTask={setSelectedId}
            onUpdateTask={updateTask}
          />
        ) : (
          <div className="task-scroll">
            {view === "checkboxes" ? (
              <>
                <p className="view-description">
                  Unfinished steps from active tasks, grouped by task.
                </p>
                {shownCheckboxes === 0 ? (
                  <Empty
                    icon={CheckCheck}
                    title={
                      checkboxQuery
                        ? "No matching checkboxes"
                        : "No open checkboxes"
                    }
                    body={
                      checkboxQuery
                        ? "Try a step, task name, or tag."
                        : "No unchecked steps in active tasks. Reopening a task brings its unfinished steps back."
                    }
                  />
                ) : (
                  checkboxGroups.map(({ task, items }) => (
                    <section className="checkbox-group" key={task.id}>
                      <button
                        className="parent-task"
                        data-open-task
                        onClick={() => setSelectedId(task.id)}
                      >
                        <span>{task.title}</span>
                        <ArrowUpRight size={14} />
                      </button>
                      {items.map((c) => (
                        <div className="open-check-row" key={c.path.join(".")}>
                          <button
                            className="task-check"
                            aria-label={`Check ${c.text}`}
                            onClick={() =>
                              updateTask(task.id, {
                                notes: toggleCheckbox(task.notes, c.path, true),
                              })
                            }
                          />
                          <button
                            data-open-task
                            onClick={() => setSelectedId(task.id)}
                          >
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
                    {...drag.destinationProps({
                      kind: "column",
                      id: column.id,
                    })}
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
                      upcoming.reduce(
                        (groups, entry) => {
                          (groups[entry.date] ??= []).push(entry);
                          return groups;
                        },
                        {} as Record<string, typeof upcoming>,
                      ),
                    )
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, tasks]) => (
                        <section key={date}>
                          <div className="section-title task-section-label">
                            {date < today
                              ? `Overdue · ${dateLabel(date)}`
                              : dateLabel(date)}
                            <span>{tasks.length}</span>
                          </div>
                          {tasks.map((entry) =>
                            taskRow(entry.task, false, entry),
                          )}
                        </section>
                      ))
                  : sorted.map((t) => taskRow(t))}
              </>
            ) : (
              <Empty
                icon={
                  view === "today" ? Sun : view === "trash" ? Trash2 : Inbox
                }
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
        )}
        <footer className="workspace-footer">
          <span>
            {view === "checkboxes"
              ? `${checkboxQuery ? `${shownCheckboxes} of ` : ""}${openItems.length} open ${openItems.length === 1 ? "checkbox" : "checkboxes"}`
              : `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`}
          </span>
          {drag.reorderEnabled &&
            visible.some((task) =>
              Number.isFinite(task.manualOrder?.[view]),
            ) && (
              <button
                className="task-order-hint"
                title="Reset to priority order"
                aria-label="Reset to priority order"
                onClick={drag.resetOrder}
              >
                Manual order
              </button>
            )}
          <button onClick={() => setSettings(true)}>
            <Keyboard size={14} />
            Shortcuts
          </button>
        </footer>
      </main>
      {selected && (
        <aside
          ref={detailRef}
          className="detail"
          key={selected.id}
          aria-label="Task details"
        >
          <header className="detail-top" data-window-drag>
            <button
              className="detail-back"
              onClick={() => setSelectedId(null)}
              aria-label="Back to tasks"
            >
              <ArrowLeft size={18} />
            </button>
            <IconButton
              className="icon-button detail-close"
              label="Close task"
              onClick={() => setSelectedId(null)}
            >
              <X size={17} />
            </IconButton>
            <button
              className={`task-check large ${selected.completedAt ? "checked" : ""} ${selected.completedAt && completion.completing.has(selected.id) ? "is-celebrating" : ""}`}
              aria-label={
                selected.completedAt ? "Reopen task" : "Complete task"
              }
              onClick={() => complete(selected)}
            >
              <CompletionMark
                checked={!!selected.completedAt}
                celebrating={
                  !!selected.completedAt &&
                  completion.completing.has(selected.id)
                }
              />
            </button>
            <TaskScheduleField
              key={selected.id}
              dates={workDates(selected)}
              deadline={selected.deadline}
              today={today}
              onChange={({ dates, deadline }) =>
                updateTask(selected.id, { ...schedulePatch(dates), deadline })
              }
            />
            <div className="detail-actions">
              <label
                className={`priority-field priority-${taskPriority(selected)}`}
                title={`Priority: ${priorityLabels[taskPriority(selected)]}`}
              >
                <Flag
                  size={17}
                  fill={taskPriority(selected) ? "currentColor" : "none"}
                />
                <span className="visually-hidden">Priority</span>
                <select
                  aria-label="Task priority"
                  value={taskPriority(selected)}
                  onChange={(event) =>
                    updateTask(selected.id, {
                      priority: Number(event.target.value) as 0 | 1 | 2 | 3,
                    })
                  }
                >
                  {priorityLabels.map((label, value) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
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
            </div>
          </header>
          {touch && error && !showWorkspaceSetup && (
            <div className="error-banner detail-error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <div className="detail-scroll">
            <div className="task-title-editor">
              <textarea
                {...noTextSuggestions}
                aria-label="Task title"
                ref={titleRef}
                rows={1}
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
            <div className="task-properties">
              <div className="detail-project">
                <i
                  style={{
                    background:
                      projects.find((p) => p.id === selected.projectId)
                        ?.color ?? "#929bab",
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
              <div className="task-property-row">
                <div className="status-field">
                  <i
                    style={{
                      background: columns.find(
                        (c) => c.id === selected.columnId,
                      )?.color,
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
              </div>
              <TaskTags
                tags={tags}
                tagIds={selected.tagIds ?? []}
                onChange={(tagIds) => updateTask(selected.id, { tagIds })}
                onCreate={(draft) => createTag(draft, selected.id)}
              />
              <TaskCalendarLinks
                compact
                task={selected}
                tasks={state.tasks}
                api={calendar}
                onUpdateTask={updateTask}
                onOpenTask={setSelectedId}
              />
            </div>
            <TaskEditor
              key={selected.id}
              taskId={selected.id}
              content={selected.notes}
              onChange={(notes) => updateTask(selected.id, { notes })}
              onPendingChange={setNotePending}
              onAttach={attach}
              onOpenFile={openNoteFile}
              vimEnabled={vimEnabled}
            />
            {selected.attachments.length > 0 && (
              <section className="attachments">
                <div className="section-title">
                  ATTACHMENTS<span>{selected.attachments.length}</span>
                </div>
                {selected.attachments.map((a) => (
                  <div className="attachment" key={a.id}>
                    <button
                      onClick={() => {
                        if (
                          isNative() &&
                          (a.mime === "application/pdf" ||
                            a.name.toLowerCase().endsWith(".pdf"))
                        )
                          nativeSend({
                            action: "openAttachment",
                            attachment: a,
                          });
                        else setAttachmentPreview(a);
                      }}
                    >
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
            <span className={`saved-label ${error ? "has-save-error" : ""}`}>
              {error
                ? "Not saved"
                : saving || notePending
                  ? "Saving…"
                  : "Saved"}
            </span>
            <span>
              {selected.example
                ? "Example task · make it your own"
                : `Created ${new Date(selected.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </span>
          </footer>
        </aside>
      )}
      {touch && touchFocus && (
        <button
          type="button"
          className="mobile-keyboard-done"
          aria-label="Dismiss keyboard"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            dismissSoftwareKeyboard();
            setTouchFocus(false);
          }}
        >
          Done
        </button>
      )}
      {showWorkspaceSetup && (
        <IOSWorkspaceSetup
          error={error}
          onConnect={() => {
            setError("");
            nativeSend({ action: "chooseFolder" });
          }}
          onContinue={() => {
            finishIOSWorkspaceSetup();
            setWorkspaceSetup(false);
          }}
        />
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
              <h3>Feedback</h3>
              <label
                className="editor-setting"
                htmlFor="completion-sound-toggle"
              >
                <span>
                  <strong>Completion sound</strong>
                  <span>A gentle chime when you finish a task.</span>
                </span>
                <input
                  id="completion-sound-toggle"
                  type="checkbox"
                  role="switch"
                  aria-label="Completion sound"
                  checked={completionSound}
                  onChange={(event) => {
                    setCompletionSound(event.target.checked);
                    writeCompletionSoundPreference(event.target.checked);
                  }}
                />
              </label>
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
              <h3>Calendars</h3>
              <CalendarSettings api={calendar} />
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
                <span>Note elements</span>
                <kbd>⌘ /</kbd>
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
                The example tasks show how work days, deadlines, and rich notes
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
              <h3>Privacy</h3>
              <PrivacyInfo />
              <p className="version">
                {APP_NAME} {APP_VERSION} · Built around your day
              </p>
            </div>
          </section>
        </div>
      )}
      {listMenu && (
        <ListOptions
          anchor={listMenu}
          onClose={() => setListMenu(null)}
          onEdit={() => {
            const project = projects.find((p) => p.id === listMenu.id);
            if (project)
              setDialog({
                kind: "project",
                id: project.id,
                value: project.name,
              });
            setListMenu(null);
          }}
          onDelete={() => {
            setListDelete({ id: listMenu.id, returnFocus: listMenu.element });
            setListMenu(null);
          }}
        />
      )}
      {listDelete && deletingList && (
        <DeleteListDialog
          name={deletingList.name}
          activeCount={
            deletingTasks.filter((t) => !t.completedAt && !t.deletedAt).length
          }
          completedCount={
            deletingTasks.filter((t) => t.completedAt && !t.deletedAt).length
          }
          trashCount={deletingTasks.filter((t) => t.deletedAt).length}
          returnFocus={listDelete.returnFocus}
          onClose={() => setListDelete(null)}
          onConfirm={confirmListDeletion}
        />
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
                {dialog.id
                  ? dialog.kind === "project"
                    ? "Edit"
                    : "Rename"
                  : "New"}{" "}
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
              {dialog.kind === "project" && dialog.id && (
                <button
                  type="button"
                  className="record-delete-action"
                  onClick={() => {
                    const returnFocus = Array.from(
                      document.querySelectorAll<HTMLElement>(
                        '[data-task-drop-kind="project"]',
                      ),
                    ).find(
                      (element) => element.dataset.taskDropId === dialog.id,
                    );
                    setListDelete({ id: dialog.id!, returnFocus });
                    setDialog(null);
                  }}
                >
                  <Trash2 size={15} />
                  Delete list…
                </button>
              )}
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
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const controls = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), a[href]",
                ),
              );
              if (event.shiftKey && document.activeElement === controls[0]) {
                event.preventDefault();
                controls.at(-1)?.focus();
              } else if (
                !event.shiftKey &&
                document.activeElement === controls.at(-1)
              ) {
                event.preventDefault();
                controls[0]?.focus();
              }
            }}
          >
            <header>
              <h2>{attachmentPreview.name}</h2>
              {!isNative() && (
                <a
                  href={attachmentPreview.url}
                  download={attachmentPreview.name}
                  className="icon-button"
                  aria-label="Download attachment"
                  title="Download attachment"
                >
                  <Download size={18} />
                </a>
              )}
              {isNative() && (
                <IconButton
                  label="Open attachment externally"
                  onClick={() =>
                    nativeSend({
                      action: "openAttachment",
                      attachment: attachmentPreview,
                    })
                  }
                >
                  <ExternalLink size={18} />
                </IconButton>
              )}
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
              <PdfPreview
                url={attachmentPreview.url}
                name={attachmentPreview.name}
              />
            ) : (
              <div className="file-preview-fallback">
                <FileText size={40} />
                <p>Open this file in its default app.</p>
                {isNative() ? (
                  <button
                    className="primary-button"
                    onClick={() =>
                      nativeSend({
                        action: "openAttachment",
                        attachment: attachmentPreview,
                      })
                    }
                  >
                    Open file
                  </button>
                ) : (
                  <a
                    className="primary-button"
                    href={attachmentPreview.url}
                    download={attachmentPreview.name}
                  >
                    Download file
                  </a>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {listUndo && !toast && !drag.notice && (
        <div className="toast list-delete-notice" role="status">
          <span>“{listUndo.name}” deleted. Tasks kept.</span>
          <button
            aria-label="Undo list deletion"
            onClick={() => {
              const receipt = listUndo;
              const canRestore = state.projects.some(
                (project) =>
                  project.id === receipt.id &&
                  project.deletedAt === receipt.deletedAt,
              );
              setState((current) => undoDeleteList(current, receipt, now()));
              setListUndo(null);
              if (canRestore) {
                changeView(`project:${receipt.id}`);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      '[aria-label="List options"]',
                    )
                    ?.focus({ preventScroll: true }),
                );
              }
            }}
          >
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss list deletion message"
            onClick={() => setListUndo(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {!toast && <TaskDragNotice drag={drag} />}
      {!listUndo && !toast && !drag.notice && completion.notice && (
        <div className="toast completion-toast" role="status">
          <Check size={16} />
          <span>Completed {completion.notice.title}</span>
          <button
            onClick={() => {
              const task = state.tasks.find(
                (item) => item.id === completion.notice!.id,
              );
              if (task?.completedAt) complete(task);
              else completion.cancel(completion.notice!.id);
            }}
            aria-label="Undo task completion"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
function IOSWorkspaceSetup({
  error,
  onConnect,
  onContinue,
}: {
  error: string;
  onConnect: () => void;
  onContinue: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  return (
    <div className="modal-backdrop ios-workspace-backdrop">
      <section
        ref={dialog}
        className="modal ios-workspace-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ios-workspace-title"
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const controls =
              dialog.current?.querySelectorAll<HTMLButtonElement>("button");
            const first = controls?.[0],
              last = controls?.[1];
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
        <span className="ios-workspace-icon">
          <Cloud size={30} />
        </span>
        <p className="ios-workspace-eyebrow">{APP_NAME}</p>
        <h2 id="ios-workspace-title">Connect your Mac workspace</h2>
        <p>
          Choose the same workspace folder you already use on your Mac. In the
          folder picker, find your existing folder in iCloud Drive.
        </p>
        <p className="ios-workspace-help">
          Your tasks, notes, and attachments will stay together on both devices.
          You can also connect later in Settings.
        </p>
        {error && (
          <div className="error-banner setup-error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="ios-workspace-actions">
          <button
            type="button"
            className="primary-button"
            autoFocus
            onClick={onConnect}
          >
            <FolderOpen size={17} />
            Choose workspace folder
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onContinue}
          >
            Continue on this device
          </button>
        </div>
      </section>
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
export default App;
