import { ResearchFailure } from "@/lib/research/failure";

export async function settleList<T>(work: Promise<T[]>, failures: string[], message: string) {
  try {
    return await work;
  } catch (error) {
    rethrowAccountFailure(error);
    failures.push(message);
    return [];
  }
}

export async function settleText(work: Promise<string | null>, failures: string[], message: string) {
  try {
    return await work;
  } catch (error) {
    rethrowAccountFailure(error);
    failures.push(message);
    return null;
  }
}

function rethrowAccountFailure(error: unknown): asserts error is unknown {
  if (error instanceof ResearchFailure && (error.status === 402 || error.status === 503)) throw error;
}
