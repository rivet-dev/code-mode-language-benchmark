// The suite's process tool-call protocol served by a small C host instead of Node, to show how
// much of each plotted round trip is the Node host's own cost. Same guests, same arguments, same
// statistic: median over batches of BATCH calls, timed at the guest's "mark" lines.
//
// Usage: toolcall_c <calls> <warmup> <batch> <command> [args...]
// Prints: batch_mean_median_us host_cpu_us sandbox_cpu_us
#define _GNU_SOURCE
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

extern char **environ;

static double now_us(void) {
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return now.tv_sec * 1e6 + now.tv_nsec / 1e3;
}

static double self_cpu_us(void) {
	struct timespec now;
	clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &now);
	return now.tv_sec * 1e6 + now.tv_nsec / 1e3;
}

static double child_cpu_us(pid_t pid) {
	char path[64];
	char stat[2048];
	snprintf(path, sizeof path, "/proc/%d/stat", pid);
	FILE *file = fopen(path, "r");
	if (file == NULL) return 0;
	size_t length = fread(stat, 1, sizeof stat - 1, file);
	fclose(file);
	stat[length] = 0;
	char *fields = strrchr(stat, ')');
	if (fields == NULL) return 0;
	unsigned long user = 0;
	unsigned long system = 0;
	// After ")": state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime.
	sscanf(fields + 2, "%*c %*d %*d %*d %*d %*d %*u %*u %*u %*u %*u %lu %lu", &user, &system);
	return (double)(user + system) * 1e6 / sysconf(_SC_CLK_TCK);
}

static int compare_doubles(const void *left, const void *right) {
	double a = *(const double *)left;
	double b = *(const double *)right;
	return (a > b) - (a < b);
}

int main(int argc, char **argv) {
	if (argc < 5) {
		fprintf(stderr, "usage: toolcall_c <calls> <warmup> <batch> <command> [args...]\n");
		return 2;
	}
	long calls = atol(argv[1]);
	int batch = atoi(argv[3]);

	// The guest receives the same trailing arguments the suite passes: calls, warmup, batch.
	int command_count = argc - 4;
	char **child_argv = calloc(command_count + 4, sizeof *child_argv);
	for (int index = 0; index < command_count; index++) child_argv[index] = argv[4 + index];
	child_argv[command_count] = argv[1];
	child_argv[command_count + 1] = argv[2];
	child_argv[command_count + 2] = argv[3];

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
	if (posix_spawnp(&pid, child_argv[0], &actions, NULL, child_argv, environ) != 0) {
		perror("posix_spawnp");
		return 1;
	}
	close(to_child[0]);
	close(from_child[1]);

	long max_marks = calls / batch + 4;
	double *mark_at = malloc(sizeof *mark_at * max_marks);
	double first_host_cpu = 0;
	double first_child_cpu = 0;
	double last_host_cpu = 0;
	double last_child_cpu = 0;
	long marks = 0;

	static char buffer[1 << 16];
	size_t filled = 0;
	int done = 0;
	while (!done) {
		ssize_t count = read(from_child[0], buffer + filled, sizeof buffer - filled);
		if (count <= 0) {
			fprintf(stderr, "guest closed stdout early\n");
			return 1;
		}
		filled += count;
		size_t start = 0;
		for (;;) {
			char *newline = memchr(buffer + start, '\n', filled - start);
			if (newline == NULL) break;
			size_t line_length = newline - (buffer + start);
			char *line = buffer + start;
			if (line_length == 4 && memcmp(line, "mark", 4) == 0) {
				if (marks < max_marks) mark_at[marks] = now_us();
				double host_cpu = self_cpu_us();
				double guest_cpu = child_cpu_us(pid);
				if (marks == 0) {
					first_host_cpu = host_cpu;
					first_child_cpu = guest_cpu;
				}
				last_host_cpu = host_cpu;
				last_child_cpu = guest_cpu;
				marks++;
			} else if (line_length == 4 && memcmp(line, "done", 4) == 0) {
				done = 1;
			} else {
				char *id_field = memmem(line, line_length, "\"id\":", 5);
				if (id_field == NULL) {
					fprintf(stderr, "unexpected line\n");
					return 1;
				}
				long id = strtol(id_field + 5, NULL, 10);
				char reply[96];
				int reply_length = snprintf(reply, sizeof reply, "{\"id\":%ld,\"ok\":true,\"value\":22}\n", id);
				if (write(to_child[1], reply, reply_length) != reply_length) {
					perror("write");
					return 1;
				}
			}
			start += line_length + 1;
		}
		memmove(buffer, buffer + start, filled - start);
		filled -= start;
	}
	close(to_child[1]);
	int status;
	waitpid(pid, &status, 0);

	long intervals = marks - 1;
	double *batch_means = malloc(sizeof *batch_means * intervals);
	for (long index = 1; index < marks; index++) batch_means[index - 1] = (mark_at[index] - mark_at[index - 1]) / batch;
	qsort(batch_means, intervals, sizeof *batch_means, compare_doubles);
	printf("%.2f %.2f %.2f\n", batch_means[intervals / 2], (last_host_cpu - first_host_cpu) / calls, (last_child_cpu - first_child_cpu) / calls);
	return 0;
}
