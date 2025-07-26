""def is_prime(num):
    if num <= 1:
        return False
    for i in range(2, int(num**0.5) + 1):
        if num % i == 0:
            return False
    return True

primes = []
i = 2
while len(primes) < 30:
    if is_prime(i):
        primes.append(i)
    i += 1

print(primes)
""
