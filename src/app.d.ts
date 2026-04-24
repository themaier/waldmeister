// See https://svelte.dev/docs/kit/types#app
declare global {
  namespace App {
    interface Error {
      message: string;
    }
    interface Locals {
      user: {
        id: string;
        email: string;
        name: string;
      } | null;
      session: {
        id: string;
        expiresAt: Date;
      } | null;
    }
    interface PageData {
      user?: App.Locals['user'];
    }
    // interface Platform {}
  }
}

export {};
