class Solution {
    public List<List<Integer>> threeSum(int[] nums) {
        /* triplets ni , nj , nk and i,j,k different
           ni+nj+nk=0
           and no duplicate triplets brother
        */
        //1 sorting + 2-pointer
        Arrays.sort(nums);
        List<List<Integer>> ans = new ArrayList<>();
        int n = nums.length;
        for(int i=0 ; i<n-2 ; i++){
            if (i!=0 && nums[i]==nums[i-1])continue;
            int left =i+1;
            int right =n-1;

            boolean b =false;
            while(left < right){
                if(left!=i+1 && nums[left]==nums[left-1] && b)continue;
                b=false;
                int s =nums[i]+nums[left]+nums[right];
                if(s == 0){
                    ans.add(Arrays.asList(nums[i],nums[left],nums[right]));
                    left++;
                    right--;
                }else if (s<0) left++;
                else right --;
            }
        }
        return ans;
    }
}