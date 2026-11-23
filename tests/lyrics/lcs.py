import numpy as np
def lcs_recall(ref, hyp):
    """Share of the reference characters found, in order, in the transcript (optimal alignment, not greedy)."""
    a = np.frombuffer(ref.encode('utf-32-le'), dtype=np.uint32); b = np.frombuffer(hyp.encode('utf-32-le'), dtype=np.uint32)
    prev = np.zeros(len(b) + 1, np.int32)
    for x in a:
        eq = (b == x)
        cur = np.zeros_like(prev)
        # cur[j+1] = prev[j]+1 if eq else max(prev[j+1], cur[j])
        diag = prev[:-1] + eq
        best = np.maximum(prev[1:], diag)
        cur[1:] = np.maximum.accumulate(best)  # max with left neighbour (monotone along row)
        prev = cur
    return round(float(prev[-1]) / len(a), 3)
