export const createConcurrencyLimiter = (maxConcurrent: number) => {
  let activeCount = 0;
  const pendingTasks: Array<() => void> = [];

  const drain = () => {
    if (activeCount >= maxConcurrent) {
      return;
    }

    const nextTask = pendingTasks.shift();
    if (!nextTask) {
      return;
    }

    nextTask();
  };

  const run = <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        activeCount += 1;
        const taskPromise = task();

        taskPromise.then(resolve, reject).finally(() => {
          activeCount -= 1;
          drain();
        });
      };

      pendingTasks.push(start);
      drain();
    });

  return run;
};
