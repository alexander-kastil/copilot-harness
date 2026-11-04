declare module 'vscode' {
  export interface ProvideLanguageModelChatResponseOptions {
    readonly requestInitiator: string;
  }

  export interface LanguageModelChatInformation {
    requiresAuthorization?: true | { label: string };

    readonly isDefault?: boolean;

    readonly isUserSelectable?: boolean;

    readonly category?: { label: string; order: number };

    readonly statusIcon?: ThemeIcon;

    readonly isBYOK?: boolean;
  }

  export interface LanguageModelChatCapabilities {
    readonly editTools?: string[];
  }

  export type LanguageModelResponsePart2 =
    LanguageModelResponsePart | LanguageModelDataPart | LanguageModelThinkingPart;

  export interface LanguageModelChatProvider<T extends LanguageModelChatInformation = LanguageModelChatInformation> {
    provideLanguageModelChatResponse(
      model: T,
      messages: readonly LanguageModelChatRequestMessage[],
      options: ProvideLanguageModelChatResponseOptions,
      progress: Progress<LanguageModelResponsePart2>,
      token: CancellationToken,
    ): Thenable<void>;
  }
}
