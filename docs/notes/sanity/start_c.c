// Spawn-to-first-line start time measured from a small C host with posix_spawn, to separate a
// runtime's own start cost from the Node host's spawn and event-loop overhead.
//
// Usage: start_c <runs> <command> [args...]
// Prints: median_ms p10_ms p90_ms
#define _GNU_SOURCE
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static double now_ms(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return now.tv_sec * 1e3 + now.tv_nsec / 1e6;
}

static int compare_doubles(const void *left, const void *right) {
	double a = *(const double *)left;
	double b = *(const double *)right;
	return (a > b) - (a < b);
}

int main(int argc, char **argv) {
	if (argc < 3) {
		fprintf(stderr, "usage: start_c <runs> <command> [args...]\n");
		return 2;
	}
	int runs = atoi(argv[1]);
	char **command = argv + 2;
	double *samples = malloc(sizeof *samples * runs);

	for (int run = 0; run < runs + 2; run++) {
		int to_child[2];
		int from_child[2];
		if (pipe2(to_child, O_CLOEXEC) != 0 || pipe2(from_child, O_CLOEXEC) != 0) {
			perror("pipe2");
			return 1;
		}
		posix_spawn_file_actions_t actions;
		posix_spawn_file_actions_init(&actions);
		posix_spawn_file_actions_adddup2(&actions, to_child[0], 0);
		posix_spawn_file_actions_adddup2(&actions, from_child[1], 1);

		pid_t pid;
		double started = now_ms();
		if (posix_spawnp(&pid, command[0], &actions, NULL, command, environ) != 0) {
			perror("posix_spawnp");
			return 1;
		}
		close(to_child[0]);
		close(from_child[1]);

		char buffer[256];
		int length = 0;
		for (;;) {
			ssize_t count = read(from_child[0], buffer + length, sizeof buffer - 1 - length);
			if (count <= 0) {
				fprintf(stderr, "child closed stdout before answering\n");
				return 1;
			}
			length += count;
			buffer[length] = 0;
			if (strchr(buffer, '\n') != NULL) break;
		}
		double elapsed = now_ms() - started;
		if (buffer[0] != '2') {
			fprintf(stderr, "unexpected answer: %s\n", buffer);
			return 1;
		}

		close(to_child[1]);
		int status;
		waitpid(pid, &status, 0);
		close(from_child[0]);
		posix_spawn_file_actions_destroy(&actions);
		if (run >= 2) samples[run - 2] = elapsed;
	}

	qsort(samples, runs, sizeof *samples, compare_doubles);
	printf("%.3f %.3f %.3f\n", samples[runs / 2], samples[runs / 10], samples[(runs * 9) / 10]);
	return 0;
}
