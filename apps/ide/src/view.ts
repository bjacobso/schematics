import { Badge, Button, Table, Textarea, Toolbar, sxAttrs } from "@foldworks/ui";
import { History, Moon, PackageCheck, RefreshCw, Save, Sun } from "@lucide/icons";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { Message } from "./message";
import type { Model, Panel } from "./model";
import { styles as s } from "./styles";

const shortId = (value: string): string =>
  value.length > 22 ? `${value.slice(0, 14)}…${value.slice(-7)}` : value;

const validationBadge = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.validation.valid
    ? Badge.view({ label: "Valid", tone: "success", dot: true }, h)
    : Badge.view(
        {
          label: `${model.validation.errorCount} validation errors`,
          tone: "danger",
          dot: true,
        },
        h,
      );

const appToolbar = (model: Model, h: HtmlBuilder<Message>): Html => {
  const dirty = model.draft !== model.savedContent;
  const busy = model.status !== "Ready";
  return h.div(sxAttrs(h, s.toolbar), [
    Toolbar.view(
      {
        title: "Schematics",
        description: "Resource control plane · Triplex releases · Effect runtime",
        leading: [
          Badge.view(
            {
              label: model.capabilities?.mode ?? "connecting",
              tone: model.status === "Failed" ? "danger" : "neutral",
              dot: true,
            },
            h,
          ),
        ],
        actions: [
          validationBadge(model, h),
          Button.view(
            {
              label: model.status === "Saving" ? "Saving…" : "Save",
              icon: Save,
              size: "sm",
              onClick: Message.RequestedSave(),
              isDisabled: busy || !dirty || !model.activePath,
            },
            h,
          ),
          Button.view(
            {
              label: model.status === "Publishing" ? "Publishing…" : "Publish release",
              icon: PackageCheck,
              size: "sm",
              variant: "primary",
              onClick: Message.RequestedPublish(),
              isDisabled: busy || dirty || model.files.length === 0 || !model.validation.valid,
            },
            h,
          ),
          Button.view(
            {
              icon: model.mode === "light" ? Moon : Sun,
              size: "icon",
              variant: "ghost",
              ariaLabel: `Use ${model.mode === "light" ? "dark" : "light"} appearance`,
              onClick: Message.ToggledMode(),
            },
            h,
          ),
        ],
      },
      h,
    ),
  ]);
};

const fileRail = (model: Model, h: HtmlBuilder<Message>): Html => {
  const dirty = model.draft !== model.savedContent;
  return h.aside(
    [...sxAttrs(h, s.rail), h.AriaLabel("Declarations")],
    [
      h.h2(sxAttrs(h, s.railHeading), [`Declarations · ${model.files.length}`]),
      h.div(
        sxAttrs(h, s.fileList),
        model.files.map((file) =>
          h.button(
            [
              ...sxAttrs(h, s.fileButton, file.path === model.activePath && s.activeFile),
              h.Type("button"),
              h.Title(file.path),
              h.Disabled(dirty || model.status !== "Ready"),
              h.AriaPressed(String(file.path === model.activePath)),
              h.OnClick(Message.SelectedFile({ path: file.path })),
            ],
            [file.path],
          ),
        ),
      ),
    ],
  );
};

const editor = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (!model.activePath) {
    return h.div(sxAttrs(h, s.empty), [
      h.div(
        [],
        [
          h.p(
            [],
            [model.status === "Loading" ? "Loading declarations…" : "No declarations found."],
          ),
          ...(model.status === "Failed"
            ? [
                Button.view(
                  {
                    label: "Try again",
                    icon: RefreshCw,
                    variant: "outline",
                    onClick: Message.RequestedReload(),
                  },
                  h,
                ),
              ]
            : []),
        ],
      ),
    ]);
  }
  return h.main(sxAttrs(h, s.content), [
    h.div(sxAttrs(h, s.documentHeading), [
      h.h1(sxAttrs(h, s.path), [model.activePath]),
      Badge.view(
        {
          label: model.draft === model.savedContent ? `revision ${model.revision}` : "unsaved",
          tone: model.draft === model.savedContent ? "neutral" : "warning",
        },
        h,
      ),
    ]),
    ...(model.error ? [h.p(sxAttrs(h, s.muted), [model.error])] : []),
    h.div(sxAttrs(h, s.editorFrame), [
      Textarea.view(
        {
          id: "schematics-document-editor",
          value: model.draft,
          ariaLabel: `Edit ${model.activePath}`,
          isDisabled: model.status !== "Ready",
          onInput: (value) => Message.ChangedDraft({ value }),
          style: s.editor,
        },
        h,
      ),
    ]),
  ]);
};

const panelButton = (panel: Panel, model: Model, h: HtmlBuilder<Message>): Html =>
  Button.view(
    {
      label: panel,
      ...(panel === "History"
        ? { icon: History }
        : panel === "Release"
          ? { icon: PackageCheck }
          : {}),
      size: "sm",
      variant: model.panel === panel ? "secondary" : "ghost",
      attributes: [h.AriaPressed(String(model.panel === panel))],
      onClick: Message.SelectedPanel({ panel }),
    },
    h,
  );

const documentPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(sxAttrs(h, s.stack), [
    h.section(sxAttrs(h, s.section), [
      h.h2(sxAttrs(h, s.sectionTitle), ["Validation"]),
      validationBadge(model, h),
      h.p(sxAttrs(h, s.muted), [
        `${model.validation.errorCount} errors · ${model.validation.warningCount} warnings · ${model.validation.infoCount} information`,
      ]),
    ]),
    h.section(sxAttrs(h, s.section), [
      h.h2(sxAttrs(h, s.sectionTitle), ["Workspace basis"]),
      h.p(sxAttrs(h, s.muted), [
        `Mutable workspace revision ${model.revision}. Publishing captures every declaration as one immutable graph.`,
      ]),
    ]),
  ]);

const releasePanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.release === null
    ? h.section(sxAttrs(h, s.section), [
        h.h2(sxAttrs(h, s.sectionTitle), ["No release yet"]),
        h.p(sxAttrs(h, s.muted), [
          "Save a valid workspace, then publish it to create a content-addressed Triplex release.",
        ]),
      ])
    : h.div(sxAttrs(h, s.stack), [
        h.section(sxAttrs(h, s.section), [
          h.h2(sxAttrs(h, s.sectionTitle), [model.release.label]),
          Badge.view({ label: model.release.ref, tone: "info", dot: true }, h),
          h.code(sxAttrs(h, s.code), [model.release.snapshotId]),
        ]),
        h.section(sxAttrs(h, s.section), [
          h.h2(sxAttrs(h, s.sectionTitle), ["Pinned graph"]),
          h.p(sxAttrs(h, s.muted), [
            `${model.release.createdRevisionCount} new object revisions · transaction position ${model.release.position}`,
          ]),
          h.code(sxAttrs(h, s.code), [`root ${model.release.rootContentId}`]),
          h.code(sxAttrs(h, s.code), [`tx ${model.release.transactionId}`]),
        ]),
      ]);

const historyPanel = (model: Model, h: HtmlBuilder<Message>): Html =>
  model.releaseHistory.length === 0
    ? h.section(sxAttrs(h, s.section), [
        h.h2(sxAttrs(h, s.sectionTitle), ["Release history"]),
        h.p(sxAttrs(h, s.muted), [
          "Published releases appear here without replacing prior revisions.",
        ]),
      ])
    : Table.view(
        {
          caption: "Triplex declaration releases",
          columns: ["Release", "Snapshot", "Objects"],
          rows: model.releaseHistory.map((release) => [
            release.label,
            shortId(release.snapshotId),
            String(release.revisionCount),
          ]),
        },
        h,
      );

const inspector = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [...sxAttrs(h, s.inspector), h.AriaLabel("Workspace inspector")],
    [
      h.div(sxAttrs(h, s.tabs), [
        panelButton("Document", model, h),
        panelButton("Release", model, h),
        panelButton("History", model, h),
      ]),
      model.panel === "Release"
        ? releasePanel(model, h)
        : model.panel === "History"
          ? historyPanel(model, h)
          : documentPanel(model, h),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `${model.activePath || "Workspace"} | Schematics`,
  lang: "en",
  body: h.div(
    [
      ...sxAttrs(h, s.root),
      h.DataAttribute("theme", "neutral"),
      h.DataAttribute("mode", model.mode),
    ],
    [
      appToolbar(model, h),
      h.div(sxAttrs(h, s.workspace), [fileRail(model, h), editor(model, h), inspector(model, h)]),
      h.footer(sxAttrs(h, s.status), [
        h.span([], [model.announcement]),
        h.span(
          [],
          [model.release === null ? "No release" : `draft · ${shortId(model.release.snapshotId)}`],
        ),
      ]),
      h.div(
        [h.Role("status"), h.AriaLive("polite"), ...sxAttrs(h, s.srOnly)],
        [model.announcement],
      ),
    ],
  ),
});
