export function createUploadQueue<T>(upload: (batch: T) => Promise<void>) {
  let tail = Promise.resolve();
  return {
    enqueue(batch: T): Promise<void> {
      const task = tail.then(() => upload(batch));
      tail = task.catch(() => undefined);
      return task;
    },
  };
}
