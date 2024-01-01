export interface Messages {
    "Whoops, that page doesn't exist": string;
    "Couldn't load mesage": string;
    "Invalid stream": string;
    "Sorry, an unknown error occured": string;
    "End of list": string;
    or: string;
    "Create a new chat": string;
    "Chat name": string;
    "User name": string;
    "Join a chat": string;
    "Create chat": string;
    "Only admins can invite": string;
    "Creating chat ...": string;
    "Chat with family and friends": string;
    "Please specify a chat name": string;
    "Please specify a user name": string;
}

const english: Messages = {
    "Whoops, that page doesn't exist": "Whoops, that page doesn't exist",
    "Couldn't load mesage": "Couldn't load mesage",
    "Invalid stream": "Invalid stream",
    "Sorry, an unknown error occured": "Sorry, an unknown error occured",
    "End of list": "End of list",
    or: "or",
    "Create a new chat": "Create a new chat",
    "Chat name": "Chat name",
    "User name": "User name",
    "Join a chat": "Join a chat",
    "Create chat": "Create chat",
    "Only admins can invite": "Only admins can invite",
    "Creating chat ...": "Creating chat ...",
    "Chat with family and friends": "Chat with family and friends",
    "Please specify a chat name": "Please specify a chat name",
    "Please specify a user name": "Please specify a user name",
};

export type LanguageCode = "en";

const translations: Record<LanguageCode, Messages> = {
    en: english,
};

export function i18n<T extends keyof Messages>(key: T): Messages[T] {
    const userLocale = navigator.language || (navigator as any).userLanguage;
    const languageCode = userLocale ? (userLocale.split("-")[0] as LanguageCode) : "en";
    const implementation = translations[languageCode];
    const message = implementation ? implementation[key] : translations["en"][key];
    if (!message) {
        console.error("Unknown i18n string " + key);
        return key as any as Messages[T];
    }
    return message;
}
