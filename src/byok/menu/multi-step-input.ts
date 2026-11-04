import * as vscode from 'vscode';

class InputFlowAction {
  static back = new InputFlowAction();
  static cancel = new InputFlowAction();
  static resume = new InputFlowAction();
}

export type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

export interface QuickPickParameters<T extends vscode.QuickPickItem> {
  title: string;
  step: number;
  totalSteps: number;
  items: T[];
  activeItem?: T;
  placeholder: string;
  canSelectMany?: boolean;
  loadItems?: () => Promise<T[]>;
  buttons?: vscode.QuickInputButton[];
}

export interface InputBoxParameters {
  title: string;
  step: number;
  totalSteps: number;
  value: string;
  prompt: string;
  placeholder?: string;
  password?: boolean;
  validate?: (value: string) => Promise<string | undefined>;
  buttons?: vscode.QuickInputButton[];
}

export class MultiStepInput {
  private current?: vscode.QuickInput;
  private steps: InputStep[] = [];

  static async run(start: InputStep): Promise<boolean> {
    const input = new MultiStepInput();
    return input.stepThrough(start);
  }

  private async stepThrough(start: InputStep): Promise<boolean> {
    let step: InputStep | void = start;
    while (step) {
      this.steps.push(step);
      if (this.current) {
        this.current.enabled = false;
        this.current.busy = true;
      }
      try {
        step = await step(this);
      } catch (err) {
        if (err === InputFlowAction.back) {
          this.steps.pop();
          step = this.steps.pop();
        } else if (err === InputFlowAction.resume) {
          step = this.steps.pop();
        } else if (err === InputFlowAction.cancel) {
          step = undefined;
          this.current?.dispose();
          return false;
        } else {
          this.current?.dispose();
          throw err;
        }
      }
    }
    this.current?.dispose();
    return true;
  }

  async showQuickPick<T extends vscode.QuickPickItem>(p: QuickPickParameters<T>): Promise<T[]> {
    const disposables: vscode.Disposable[] = [];
    try {
      return await new Promise<T[]>((resolve, reject) => {
        const input = vscode.window.createQuickPick<T>();
        input.title = p.title;
        input.step = p.step;
        input.totalSteps = p.totalSteps;
        input.ignoreFocusOut = true;
        input.placeholder = p.placeholder;
        input.canSelectMany = p.canSelectMany ?? false;
        input.items = p.items;
        input.matchOnDescription = true;
        if (p.activeItem) {
          input.activeItems = [p.activeItem];
        }
        input.buttons = [...(this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : []), ...(p.buttons ?? [])];
        disposables.push(
          input.onDidTriggerButton((item) => {
            if (item === vscode.QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            }
          }),
          input.onDidAccept(() => {
            const picked = [...input.selectedItems];
            if (picked.length > 0) {
              resolve(picked);
            }
          }),
          input.onDidHide(() => reject(InputFlowAction.cancel)),
        );
        this.current?.dispose();
        this.current = input;
        this.current.show();
        if (p.loadItems) {
          input.busy = true;
          p.loadItems()
            .then((items) => {
              input.items = items;
              input.busy = false;
            })
            .catch(() => {
              input.busy = false;
            });
        }
      });
    } finally {
      disposables.forEach((d) => d.dispose());
    }
  }

  async showInputBox(p: InputBoxParameters): Promise<string> {
    const disposables: vscode.Disposable[] = [];
    try {
      return await new Promise<string>((resolve, reject) => {
        const input = vscode.window.createInputBox();
        input.title = p.title;
        input.step = p.step;
        input.totalSteps = p.totalSteps;
        input.value = p.value;
        input.prompt = p.prompt;
        input.placeholder = p.placeholder;
        input.password = p.password ?? false;
        input.ignoreFocusOut = true;
        input.buttons = [...(this.steps.length > 1 ? [vscode.QuickInputButtons.Back] : []), ...(p.buttons ?? [])];
        let validating: Promise<string | undefined> | undefined;
        disposables.push(
          input.onDidTriggerButton((item) => {
            if (item === vscode.QuickInputButtons.Back) {
              reject(InputFlowAction.back);
            }
          }),
          input.onDidAccept(async () => {
            const value = input.value;
            input.enabled = false;
            input.busy = true;
            const error = p.validate ? await p.validate(value) : undefined;
            if (!error) {
              resolve(value);
            } else {
              input.validationMessage = error;
            }
            input.enabled = true;
            input.busy = false;
          }),
          input.onDidChangeValue(async (text) => {
            const current = p.validate ? p.validate(text) : Promise.resolve(undefined);
            validating = current;
            const error = await current;
            if (validating === current) {
              input.validationMessage = error;
            }
          }),
          input.onDidHide(() => reject(InputFlowAction.cancel)),
        );
        this.current?.dispose();
        this.current = input;
        this.current.show();
      });
    } finally {
      disposables.forEach((d) => d.dispose());
    }
  }
}
