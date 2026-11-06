-- Policy 3 adds explicit sample-content confirmation and relaxes no existing check.
SELECT app.carry_forward_readiness_policy(2,3,
 'readiness policy 3 adds sample_content; existing schedules keep all previous checks and samples require explicit confirmation');
