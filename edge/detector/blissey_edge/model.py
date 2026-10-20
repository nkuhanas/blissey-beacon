"""Evaluate an exported model (model.json) with the standard library only.

Supported model types (exported by pipeline_v3/portable.py from scikit-learn):
- forest:   random forest; probability = mean over trees of the leaf's fall fraction
- boosting: gradient boosted trees; probability = sigmoid(init + learning_rate * sum(leaf values))
- logistic: logistic regression on standardized log features
Trees compare float32(x) <= threshold, exactly as scikit-learn does internally.
"""
import json
import math
import struct

FORMAT = 'blissey_edge_model_v1'
_F32 = struct.Struct('f')


def _f32(v):
    return _F32.unpack(_F32.pack(v))[0]


def _leaf(tree, x):
    left, right, feat, thr = tree['left'], tree['right'], tree['feature'], tree['threshold']
    node = 0
    while left[node] != -1:
        node = left[node] if x[feat[node]] <= thr[node] else right[node]
    return tree['value'][node]


class Model:
    def __init__(self, bundle):
        if bundle.get('format') != FORMAT:
            raise ValueError('Unsupported model format: %r' % bundle.get('format'))
        self.bundle = bundle
        self.spec = bundle['model']
        self.kind = self.spec['type']
        self.n_features = bundle['n_features']
        if self.kind not in ('forest', 'boosting', 'logistic'):
            raise ValueError('Unsupported model type: %r' % self.kind)

    @classmethod
    def load(cls, path):
        with open(path) as f:
            return cls(json.load(f))

    def fall_score(self, x):
        """x: feature list -> uncalibrated fall score in [0, 1]."""
        if len(x) != self.n_features:
            raise ValueError('Expected %d features, got %d' % (self.n_features, len(x)))
        if self.kind == 'logistic':
            s = self.spec
            z = s['intercept']
            for v, mu, sd, w in zip(x, s['mean'], s['scale'], s['coef']):
                z += w * ((math.log(max(v, s['log_floor'])) if s['log'] else v) - mu) / sd
            return 1.0 / (1.0 + math.exp(-z)) if z >= -700 else 0.0
        x32 = [_f32(v) for v in x]
        if self.kind == 'forest':
            trees = self.spec['trees']
            return sum(_leaf(t, x32) for t in trees) / len(trees)
        z = self.spec['init'] + self.spec['learning_rate'] * sum(_leaf(t, x32) for t in self.spec['trees'])
        return 1.0 / (1.0 + math.exp(-z)) if z >= -700 else 0.0
