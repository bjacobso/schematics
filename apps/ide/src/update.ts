import { Update } from "foldkit";
import { SchematicsArtifactProject } from "@schematics/protocol";
import { DeclarationLedger } from "@schematics/triplex";
import { LoadWorkspace, PublishRelease, SaveDocument } from "./commands";
import { Message } from "./message";
import type { Model } from "./model";

const selectedFile = (model: Model, path: string) => model.files.find((file) => file.path === path);

type Resources = SchematicsArtifactProject | DeclarationLedger;

export const update = (model: Model, message: Message): Update.Return<Model, Message, Resources> =>
  Message.match<Update.Return<Model, Message, Resources>>(message, {
    CompletedLoad: ({ files, revision, capabilities, validation, error }) => {
      if (error) {
        return {
          model: { ...model, status: "Failed", error, announcement: `Load failed: ${error}` },
        };
      }
      const active = files.find((file) => file.path === model.activePath) ?? files[0];
      return {
        model: {
          ...model,
          status: "Ready",
          files,
          revision,
          capabilities,
          validation,
          activePath: active?.path ?? "",
          draft: active?.content ?? "",
          savedContent: active?.content ?? "",
          error: "",
          announcement: `Workspace revision ${revision} loaded with ${files.length} files.`,
        },
      };
    },
    SelectedFile: ({ path }) => {
      if (model.status !== "Ready" || model.draft !== model.savedContent) return { model };
      const file = selectedFile(model, path);
      return file === undefined
        ? { model }
        : {
            model: {
              ...model,
              activePath: file.path,
              draft: file.content,
              savedContent: file.content,
              panel: "Document",
              error: "",
              announcement: `${file.path} selected.`,
            },
          };
    },
    ChangedDraft: ({ value }) =>
      model.status !== "Ready"
        ? { model }
        : { model: { ...model, draft: value, error: "", announcement: "Unsaved changes." } },
    RequestedSave: () =>
      model.status !== "Ready" || !model.activePath || model.draft === model.savedContent
        ? { model }
        : {
            model: { ...model, status: "Saving", error: "", announcement: "Saving document." },
            commands: [SaveDocument({ path: model.activePath, content: model.draft })],
          },
    CompletedSave: ({ files, revision, validation, error }) => {
      if (error) {
        return {
          model: { ...model, status: "Ready", error, announcement: `Save failed: ${error}` },
        };
      }
      const active = files.find((file) => file.path === model.activePath);
      return {
        model: {
          ...model,
          status: "Ready",
          files,
          revision,
          validation,
          draft: active?.content ?? model.draft,
          savedContent: active?.content ?? model.draft,
          error: "",
          announcement: `${model.activePath} saved as workspace revision ${revision}.`,
        },
      };
    },
    SelectedPanel: ({ panel }) => ({ model: { ...model, panel, error: "" } }),
    RequestedPublish: () =>
      model.status !== "Ready" || model.draft !== model.savedContent || model.files.length === 0
        ? { model }
        : {
            model: {
              ...model,
              status: "Publishing",
              error: "",
              announcement: "Publishing immutable declaration release.",
            },
            commands: [PublishRelease({ files: model.files, revision: model.revision })],
          },
    CompletedPublish: ({ release, history, error }) => {
      if (error || release === null) {
        return {
          model: {
            ...model,
            status: "Ready",
            error: error || "Triplex did not return a release.",
            announcement: "Declaration release failed.",
          },
        };
      }
      return {
        model: {
          ...model,
          status: "Ready",
          panel: "Release",
          release,
          releaseHistory: history,
          error: "",
          announcement: `Published ${release.label} to ${release.ref}.`,
        },
      };
    },
    ToggledMode: () => ({
      model: { ...model, mode: model.mode === "light" ? "dark" : "light" },
    }),
    RequestedReload: () =>
      model.status === "Saving" || model.status === "Publishing"
        ? { model }
        : {
            model: { ...model, status: "Loading", error: "", announcement: "Reloading workspace." },
            commands: [LoadWorkspace({})],
          },
  });
