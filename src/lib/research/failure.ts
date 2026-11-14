export class ResearchFailure extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ResearchFailure";
    this.status = status;
  }
}
