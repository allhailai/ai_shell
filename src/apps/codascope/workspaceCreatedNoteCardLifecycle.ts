import type { WorkspaceNoteApi } from "./workspaceNoteApi";
import {
  WorkspaceCreatedNoteCardController,
  type WorkspaceNoteCardState,
} from "./workspaceCreatedNoteCardController";

type ControllerFactory = (
  stableId: string,
  api: WorkspaceNoteApi,
  navigate: (subRoute: string) => void,
) => WorkspaceCreatedNoteCardController;

interface LifecycleAttachment {
  controller: WorkspaceCreatedNoteCardController;
  detach: () => void;
}

export interface WorkspaceNoteCardLifecycleOptions {
  stableId: string;
  api: WorkspaceNoteApi;
  navigate: (subRoute: string) => void;
  publish: (state: WorkspaceNoteCardState) => void;
}

export class WorkspaceCreatedNoteCardLifecycle {
  private attachment: LifecycleAttachment | null = null;

  constructor(
    private readonly createController: ControllerFactory = (
      stableId,
      api,
      navigate,
    ) => new WorkspaceCreatedNoteCardController(stableId, api, navigate),
  ) {}

  attach(options: WorkspaceNoteCardLifecycleOptions): () => void {
    this.attachment?.detach();

    const controller = this.createController(
      options.stableId,
      options.api,
      options.navigate,
    );
    let detached = false;
    const publish = (state: WorkspaceNoteCardState) => {
      if (!detached && this.attachment?.controller === controller) {
        options.publish(state);
      }
    };
    const unsubscribe = controller.subscribe(publish);
    const attachment: LifecycleAttachment = {
      controller,
      detach: () => {
        if (detached) return;
        detached = true;
        unsubscribe();
        controller.dispose();
        if (this.attachment === attachment) this.attachment = null;
      },
    };
    this.attachment = attachment;

    publish(controller.getState());
    void controller.load();
    return attachment.detach;
  }

  dispatch<T>(
    operation: (controller: WorkspaceCreatedNoteCardController) => T,
  ): T | undefined {
    const controller = this.attachment?.controller;
    return controller ? operation(controller) : undefined;
  }
}
