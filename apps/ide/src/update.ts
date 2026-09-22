import { Update } from "foldkit";
import { SchematicsArtifactProject } from "@schematics/protocol";
import { LoadWorkspace, SaveDocument } from "./commands";
import { Message } from "./message";
import type { Model } from "./model";

const selectedFile = (model: Model, path: string) => model.files.find((file) => file.path === path);

type Resources = SchematicsArtifactProject;

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
    ToggledMode: () => ({
      model: { ...model, mode: model.mode === "light" ? "dark" : "light" },
    }),
    RequestedReload: () =>
      model.status === "Saving"
        ? { model }
        : {
            model: { ...model, status: "Loading", error: "", announcement: "Reloading workspace." },
            commands: [LoadWorkspace({})],
          },
  });
