import { Badge, Button, Textarea, Toolbar, sxAttrs } from "@foldworks/ui";
import { Moon, RefreshCw, Save, Sun } from "@lucide/icons";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { Message } from "./message";
import type { Model } from "./model";
import { styles as s } from "./styles";

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
        description: "Effect runtime · Foldkit application · Foldworks UI",
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

const inspector = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.aside(
    [...sxAttrs(h, s.inspector), h.AriaLabel("Workspace inspector")],
    [
      h.div(sxAttrs(h, s.stack), [
        h.section(sxAttrs(h, s.section), [
          h.h2(sxAttrs(h, s.sectionTitle), ["Validation"]),
          validationBadge(model, h),
          h.p(sxAttrs(h, s.muted), [
            `${model.validation.errorCount} errors · ${model.validation.warningCount} warnings · ${model.validation.infoCount} information`,
          ]),
        ]),
        h.section(sxAttrs(h, s.section), [
          h.h2(sxAttrs(h, s.sectionTitle), ["Workspace"]),
          Badge.view(
            {
              label: model.capabilities?.mode ?? "connecting",
              tone: model.capabilities?.project.readOnly ? "warning" : "info",
              dot: true,
            },
            h,
          ),
          h.p(sxAttrs(h, s.muted), [
            model.capabilities === null
              ? `Workspace revision ${model.revision}.`
              : `${model.capabilities.project.title} · revision ${model.revision} · ${model.capabilities.features.write ? "writable" : "read only"}`,
          ]),
        ]),
      ]),
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
        h.span([], [`revision ${model.revision} · ${model.files.length} files`]),
      ]),
      h.div(
        [h.Role("status"), h.AriaLive("polite"), ...sxAttrs(h, s.srOnly)],
        [model.announcement],
      ),
    ],
  ),
});
